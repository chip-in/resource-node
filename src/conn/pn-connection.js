import Connection from './connection';
import constants from '../util/constants';
import uuidv4 from 'uuid/v4';
import AsyncLock from 'async-lock'
import Logger from '../util/logger';
import ConsulCluster from './cluster/consul-cluster';

const connConversionLock = new AsyncLock()

var promoteMap = {};
var staticLogger = new Logger("PNConnectionCommon");

class PNConnection extends Connection {

  constructor(primaryConn, coreNodeURL, basePath, userId, password, token, jwtUpdatepath, handlers) {
    super(coreNodeURL, basePath, userId, password, token, jwtUpdatepath, handlers);
    this.primaryConn = primaryConn;
    this.cluster = new ConsulCluster((c)=>this._onMemberJoin(c),
      (c)=>this._onMemberLeave(c),
      (c)=>this._onInitialConnClosed(c),
      (locks)=>this._onLockExpired(locks))
    this.pnOperationMap = {
      "subscribe" : {},
      "mount" : {}
    }
  }

  isPNConnection() {
    return true;
  }

  ensureConnected() {
    return Promise.resolve()
      .then(()=>{
        return this._acquireClusterMemberLock(()=>{
          this.logger.debug("Succeeded to acquire cluster member lock to ensure connected")
          if (this.isConnected) {
            return;
          }
          return Promise.resolve()
          .then(()=>this._initialize())
          .then(()=>this._waterfall((c)=>c.ensureConnected()))
          .then(()=>{
            this.logger.info("Succeeded to ensure connected for all corenode")
              this.isConnected = true
          })
        }).catch((e) => {
          this.logger.error("Failed to ensure connected for all corenode", e)
          throw e
        })
      })
  }

  _open() {
    return Promise.resolve()
      .then(()=>this._initialize())
      .then(()=>this._waterfall((c)=>c._open()))
  }

  _close() {
    return Promise.resolve()
      .then(()=>PNConnection.demote(this))
      .then((c)=>c.close())
  }
  
  fetch(href, option) {
    return Promise.resolve()
      .then(()=>this._one((c)=>c.fetch(href, option)))
  }

  publish(topicName, message) {
    return Promise.resolve()
      .then(()=>this.ensureConnected())
      .then(()=>this._waterfall((c)=>c.ensureConnected()))
      .then(()=>this._all((c)=>c.publish(topicName, message)))
  }

  subscribe(topicName, subscriber) {
    return Promise.resolve()
      .then(()=>this._one((c)=>c.subscribe(topicName, subscriber)))
      .then((key)=>{
        this.pnOperationMap["subscribe"][key] = Array.prototype.slice.call(arguments);
        return key;
      })
  }

  unsubscribe(key) {
    return Promise.resolve()
      .then(()=>this._one((c)=>c.unsubscribe(key)))
      .then(()=>{
        delete this.pnOperationMap["subscribe"][key];
      })
  }

  unsubscribeAll() {
    return Promise.resolve()
      .then(()=>this._waterfall((c)=>c.unsubscribeAll(), false, true))
      .then(()=>{
        this.pnOperationMap["subscribe"] = {};
      })
  }

  mount(path, mode, proxy, option, isRemount, remountId) {
    var mountArgs = Array.prototype.slice.call(arguments);
    return Promise.resolve()
      .then(()=>this.ensureConnected())
      .then(()=>mode==constants.MOUNT_MODE_SINGLETONMASTER?this.cluster.acquireLock(path):Promise.resolve())
      .then(()=>{
        return Promise.resolve()
        .then(()=>this._acquireClusterMemberLock(()=>{
          this.logger.debug("Succeeded to acquire cluster member lock to mount. path:" + path)
          var handle = isRemount ? remountId : uuidv4()
          return Promise.resolve()
            .then(()=>this._waterfall((c)=>c.ensureConnected()))
            .then(()=>this._all((c)=>{
              var connectionId = c.getConnectionId();
              var myOption = Object.assign({}, option)
              if (mode === "singletonMaster") {
                if (myOption.remount == null || myOption.remount) {
                  //manually remount when websocket is reconnected
                  var onReconnect = myOption.onReconnect || (() => {})
                  var onRemount = myOption.onRemount || (() => {})
                  var isReconnecting = false
                  myOption.onReconnect = () => {
                    if (isReconnecting) {
                      this.logger.info("Reconnect event has already fired for path:" + path)
                      return
                    }
                    this.logger.info("Reconnect event is fired for path:" + path)
                    isReconnecting = true
                    return Promise.resolve(onReconnect())
                    .then(()=> this.unmount(handle, true))
                    .then(()=> this.mount(path, mode, proxy, myOption, true, handle))
                    .then(()=> onRemount(handle))
                    .then(()=> isReconnecting = false)
                    .catch((e) => {
                      isReconnecting = false
                    })
                  }
                }
                //disable remount
                myOption.remount = false
                myOption.onRemount = null
              }
              return c.mount(path, mode, proxy, myOption)
                .then((handle)=>{
                  return {connectionId, handle};
                })
            }))
            .then((handles)=>{
              this.pnOperationMap["mount"][handle] = {
                handles : handles.reduce((dst, entry)=>{
                  dst[entry.connectionId] = entry.handle;
                  return dst;
                }, {}),
                mountArgs
              };
              return handle;
            })
        }))
      }).catch((e) => {
        this.logger.error("Failed to mount", e)
        throw e
      })
  }

  unmount(handle, isRemount) {
    var op = this.pnOperationMap["mount"][handle];
    if (op == null) {
      this.logger.warn("Failed to resolve unmount key. mount handle:" + handle)
      return Promise.resolve();
    }
    return Promise.resolve()
    .then(()=>this.ensureConnected())
    .then(()=>{
      return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        this.logger.debug("Succeeded to acquire cluster member lock to unmount. mount handle:" + handle)
        return Promise.resolve()
          .then(()=>this._waterfall((c)=>c.ensureConnected()))
          .then(()=>this._all((c)=>{
            var connectionId = c.getConnectionId();
            if (op.handles[connectionId] == null) {
              this.logger.warn("Failed to resolve unmount key. corenodeURL:" + c.coreNodeURL + ", and mount handle:" + handle)
              return;
            }
            return c.unmount(op.handles[connectionId])
          }))
          .then(()=>{
            if (!isRemount) {
              delete this.pnOperationMap["mount"][handle];
            }
            if (op.mountArgs[1] === constants.MOUNT_MODE_SINGLETONMASTER) {
              return this.cluster.abandonLock(op.mountArgs[0]);
            }
          })
      }))
    }).catch((e) => {
      this.logger.error("Failed to unmount", e)
      throw e
    })
  }
  
  unmountAll() {
    return Promise.resolve()
    .then(()=>this.ensureConnected())
    .then(()=>{
      return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        return Promise.resolve()
        .then(()=>this._all((c)=>c.unmountAll()))
        .then(()=>{
          return Object.keys(this.pnOperationMap["mount"]).reduce((p, handle)=>{
            var op = this.pnOperationMap["mount"][handle];
            if (op.mountArgs[1] === constants.MOUNT_MODE_SINGLETONMASTER) {
              return this.cluster.abandonLock(op.mountArgs[0], true);
            } else {
              return Promise.resolve()
            }
          }, Promise.resolve())
          .then(()=>{
            this.pnOperationMap["mount"] = {};
          })
        })
      }))
      .catch((e) => {
        this.logger.warn("Failed to unmount All", e)
        throw e
      })
    })
  }

  _initialize() {
    return this.cluster.initialize(this.primaryConn);
  }

  _waterfall(func, reverse, doAll) {
    return this.cluster.waterfall(func, reverse, doAll);
  }

  _all(func) {
    return this.cluster.all(func);
  }

  _one(func) {
    return this.cluster.one(func);
  }

  _handlePromotedConn(conn) {
    var subscribeOps =  this.pnOperationMap["subscribe"]
    return Object.keys(subscribeOps)
          .reduce((p, k)=>p.then(()=>conn.subscribe(...subscribeOps[k])), ret);
  }

  _onMemberJoin(conn) {
    return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        this.logger.debug("Succeeded to acquire cluster member lock to join member")
        var ret = Promise.resolve()
          .then(()=>conn.ensureConnected());
        var mountOps = this.pnOperationMap["mount"];
        return Object.keys(mountOps)
            .reduce((p, k)=>p.then(()=>{
              var op = mountOps[k];
              return conn.mount(...op.mountArgs)
                .then((handle)=>{
                  op.handles[conn.getConnectionId()] = handle;
                })
              }), ret);
      })).catch((e) => {
        this.logger.error("Failed to process for join member", e)
        throw e
      })
  }

  _onMemberLeave(conn) {
    return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        this.logger.debug("Succeeded to acquire cluster member lock to leave member")
        return Promise.resolve()
          .then(()=>conn.close())
          .catch((e)=>{
            this.logger.warn("Failed to close leaved connection", e)
            //IGNORE
          })
      }).catch((e) => {
        this.logger.error("Failed to process for leave member", e)
        throw e
      }))
  }

  _onInitialConnClosed(conn) {
    return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        this.logger.debug("Succeeded to acquire cluster member lock when initialCon closed")
        return Promise.resolve()
          .then(()=>this._close())
          .then(()=>this.isConnected = false)
          .catch((e)=>{
            this.logger.warn("Failed to close leaved init connection", e)
            //IGNORE
          })
      }).catch((e) => {
        this.logger.error("Failed to process for closing initial conn", e)
        throw e
      }))
  }

  _onLockExpired(locks) {
    return Promise.resolve()
      .then(()=>{
        this.logger.info("lock-expired event is fired. ");
      })
  }

  _acquireClusterMemberLock(cb) {
    if (this.cluster.isNonRedundantMode) {
      return Promise.resolve()
        .then(()=>cb())
    }
    return this.lock.acquire(this._getConnectionLockKey(), cb)
  }
  
  static promote(conn) {
    PNConnection._checkArgumentsForPromoteOrDemote(conn);
    if (conn.isPNConnection()) {
      return Promise.resolve(conn);
    }
    var connectionId = conn.getConnectionId();
    return connConversionLock.acquire(connectionId, ()=>{
      if (promoteMap[connectionId] != null) {
        //already promoted
        return Promise.resolve(promoteMap[connectionId]);
      }
      var ret = new PNConnection(conn, ...conn.getInitialArgs());
      return Promise.resolve()
      .then(()=>ret._initialize())
      .then(()=>{
        promoteMap[connectionId] = ret;
        staticLogger.info("Succeeded to promote connection")
        return ret;
      })
    }).catch((e) => {
      staticLogger.info("Failed to promote connection", e)
      throw e
    })
      
  }

  static demote(conn) {
    PNConnection._checkArgumentsForPromoteOrDemote(conn);
    return Promise.resolve()
      .then(()=>{
        if (!conn.isPNConnection()) {
          return conn;
        }
        var connectionId = conn.primaryConn.getConnectionId();
        return connConversionLock.acquire(connectionId, ()=>{
          if (promoteMap[connectionId] == null) {
            //already demoted
            return conn.cluster.getInitConnection();
          }
          delete promoteMap[connectionId];
          if (!conn.cluster.isInitialized) {
            return conn.cluster.getInitConnection();
          }
          return Promise.resolve()
          .then(()=>conn._all((c)=>c.close()))
          .then(()=>conn.cluster.finalize())
          .then(()=>{
            staticLogger.info("Succeeded to demote connection")
            return conn.cluster.getInitConnection();
          })
        })
      })

  }

  static _checkArgumentsForPromoteOrDemote(conn) {
    if (conn == null) {
      throw new Error("connection is null")
    }
    if (!(conn instanceof Connection)) {
      throw new Error("connection is invalid type")
    }
  }
}
export default PNConnection;