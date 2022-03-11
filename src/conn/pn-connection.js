import Connection from './connection';
import constants from '../util/constants';
import uuidv4 from 'uuid/v4';
import AsyncLock from 'async-lock'
import Logger from '../util/logger';
import ConsulCluster from './cluster/consul-cluster';

const connConversionLock = new AsyncLock()

var promoteMap = {};
var staticLogger = new Logger("PNConnectionCommon");

const MOUNT_RETRY_TIMEOUT_WHEN_RECOVER = 10 * 1000

class PNConnection extends Connection {

  constructor(primaryConn, coreNodeURL, basePath, userId, password, token, jwtUpdatepath, handlers) {
    super(coreNodeURL, basePath, userId, password, token, jwtUpdatepath, handlers);
    this.primaryConn = primaryConn;
    this.mountRetryInfo = []

    this.primaryConn.addConnectEventListener(() => {
      if(this.isRecovering) {
        this.logger.warn("Connect event fired in recovering. we ignore it")
        return
      }
      return Promise.resolve()
      .then(()=>this.primaryConn.setSuspended(false))
      .then(()=>this.cluster.resume())
      .then(()=>this.logger.info("Succeeded to resume cluster"))
      .then(()=>{
        const mountRetryInfo = this.mountRetryInfo
        this.mountRetryInfo = []
        mountRetryInfo.map(({mountArgs, resolve, reject})=> {
          this.mount.apply(this, mountArgs).then(resolve).catch(reject)
        })
      })
      .catch((e)=>{
        this.logger.error("Failed to resume cluster", e)
        this.logger.info("We remount all.");
        return this._onInitialConnClosed()
      })
    })

    this.primaryConn.addDisconnectEventListener(()=> {
      if(this.isRecovering) {
        this.logger.warn("Disconnect event fired in recovering. we ignore it")
        return
      }
      return Promise.resolve()
      .then(()=>this.cluster.suspend())
      .then(()=>this.primaryConn.setSuspended(true))
      .then(()=>this.logger.info("Succeeded to suspend cluster"))
      .catch((e)=>{
        this.logger.error("Failed to suspend cluster", e)
        //CONTINUE
      })
    })

    this.cluster = new ConsulCluster((c)=>this._onMemberJoin(c),
      (c)=>this._onMemberLeave(c),
      (c)=>this._onInitialConnClosed(),/*eslint-disable-line no-unused-vars*/
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
      .then(()=>this._waterfall((c)=>c._open()))
  }

  _close() {
    return Promise.resolve()
      .then(()=>this._finalize())
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
              return c.mount(path, mode, proxy, option)
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
        if ((this.isSuspendError(e) || this.cluster.isAcquiringCancelError(e)) && mode === constants.MOUNT_MODE_SINGLETONMASTER) {
          this.logger.warn(`Failed to mount(${path}) by disconnecting server. We retry after connection is recovered. `)
          return new Promise((resolve, reject) => {
            this.mountRetryInfo.push({mountArgs, resolve, reject})
          })
        } else {
          this.logger.error("Failed to mount", e)
          throw e
        }
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

  _initialize(connectionId) {
  return this.cluster.initialize(this.primaryConn)
  .then(() => {
      promoteMap[connectionId] = this;
    })
  }

  _finalize() {
    this.logger.info("PNConnection finalize process start")
    return this.cluster.finalize(true)
      .then(()=>this.logger.info("Succeeded to finalize all connection"))
      .catch((e) => {
        this.logger.warn("Failed to finalize PNConnection", e)
        //IGNORE
      })
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

  _subconnections(func) {
    return this.cluster.subconnections(func)
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

  _onInitialConnClosed(mountRetryInfo) {
    mountRetryInfo = mountRetryInfo || this.mountRetryInfo
    this.mountRetryInfo = []
    this.logger.info("Initialized connection close event is fired")
    if(this.isRecovering) {
      this.logger.info("recovery process already invoked. We retry later")
      this.needRetry = true
      return
    }
    const finishRecoveryProcess = () => {
      this.isRecovering = false
      this.logger.info("Recovery process has finished")
      if (this.needRetry) {
        setImmediate(() => {
          this.needRetry = false
          this.logger.info("Retrying recovery process")
          this._onInitialConnClosed(mountRetryInfo)
        })
      }
    }
    this.isRecovering = true
    return Promise.resolve()
      .then(()=>this._acquireClusterMemberLock(()=>{
        this.logger.info("Succeeded to acquire cluster member lock when initialCon closed")
        return Promise.resolve()
          .then(()=>this._finalize())
          .then(()=>{
            const connectionId = this.primaryConn.getConnectionId();
            delete promoteMap[connectionId]

            this.primaryConn = this.primaryConn.newConnection()
            this.isConnected = false
            this.logger.info(`Try to connect URL ${this.primaryConn.coreNodeURL}`)
            return this.primaryConn.ensureConnected()
          })
          .catch((e)=>{
            this.logger.warn("Failed to close leaved init connection", e)
            //IGNORE
          })
      }).catch((e) => {
        this.logger.error("Failed to process for closing initial conn", e)
        throw e
      }))
      .then(() => {
        this.logger.info("Succeeded to connect new node")
        const newConId = this.primaryConn.getConnectionId()
        return connConversionLock.acquire(newConId, ()=>{
          this.logger.info("Succeeded to conn conversion lock for initialCon closed")
          return Promise.resolve()
          .then(()=>this._initialize(newConId))
          .then(()=> {
            const oldPnOperationMap = this.pnOperationMap
            this.pnOperationMap = {
              "subscribe" : {},
              "mount" : {}
            }
            return Object.keys(oldPnOperationMap["mount"]).reduce((p, handle)=>{
              const op = oldPnOperationMap["mount"][handle];
              return p.then(()=>{
                return new Promise((resolve, reject) => {
                  let timeout = false
                  let timeoutId = null
                  this.mount.apply(this, op.mountArgs).then(()=>{
                    if (timeout) {
                      return
                    }
                    clearTimeout(timeoutId)
                    resolve()
                  }).catch(reject)
                  timeoutId = setTimeout(()=> {
                    timeout = true
                    this.logger.warn(`Recovering mount path(${op.mountArgs[0]}) is still going on. This will be succeeded when lock is acquired or server is restored.`)
                    resolve()
                  }, MOUNT_RETRY_TIMEOUT_WHEN_RECOVER)
                })
              })
            }, Promise.resolve())
            .then(() => {
              return Object.keys(oldPnOperationMap["subscribe"]).reduce((p, k)=>{
                const args = oldPnOperationMap["subscribe"][k];
                return p.then(()=>this.subscribe.apply(this, args))
              }, Promise.resolve());
            })
            .then(() => {
              mountRetryInfo.map(({mountArgs, resolve, reject})=> {
                this.mount.apply(this, mountArgs).then(resolve).catch(reject)
              })
            })
          })
          .then(()=>{
            staticLogger.info("Succeeded to (re)promote connection")
          })
        }).catch((e) => {
          staticLogger.info("Failed to (re)promote connection", e)
          throw e
        })
      }).then(() => {
        finishRecoveryProcess()
      }).catch((e) => {
        staticLogger.info("Failed to (re)promote connection", e)
        finishRecoveryProcess()
        throw e
      })
  }

  _onLockExpired(locks) {/*eslint-disable-line no-unused-vars*/
    return Promise.resolve()
      .then(()=>{
        this.logger.info("lock-expired event is fired. We remount all.");
        return this._onInitialConnClosed()
      })
  }

  _acquireClusterMemberLock(cb) {
    if (this.cluster.isNonRedundantMode) {
      return Promise.resolve()
        .then(()=>cb())
    }
    return this.lock.acquire(this._getConnectionLockKey(), ()=> {
      return Promise.resolve()
      .then(()=>cb())
    })
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
      .then(()=>ret._initialize(connectionId))
      .then(()=>{
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
          .then(()=>conn._subconnections((c)=>c.close()))
          .then(()=>{
            staticLogger.info("Succeeded to demote connection")
            return conn.cluster.getInitConnection();
          })
        }).catch((e) => {
          staticLogger.info("Failed to demote connection", e)
          throw e
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

  addConnectEventListener(l) {
    return this.primaryConn.addConnectEventListener(l)
  }

  removeConnectEventListener(id) {
    this.primaryConn.removeConnectEventListener(id)
  }

  addDisconnectEventListener(l) {
    return this.primaryConn.addDisconnectEventListener(l)
  }

  removeDisconnectEventListener(id) {
    return this.primaryConn.removeDisconnectEventListener(id)
  }

}
export default PNConnection;