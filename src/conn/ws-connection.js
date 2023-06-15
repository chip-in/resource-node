import ioClient from 'socket.io-client';
import uuidv4 from 'uuid/v4';
import AbstractConnection from './abstract-connection';
import WSResponse from '../conversion/ws-response';
import WSRequest from '../conversion/ws-request';

const webSocketPath = process.env.CNODE_WSOCKET_PATH || '/r';
const webSocketMsgName = process.env.CNODE_WSOCKET_MSG_NAME || 'ci-msg';  
const webSocketSkipCompress = process.env.CNODE_WSOCKET_SKIP_COMPRESS ? true : false
const webSocketSkipCompressMaxSize = process.env.CNODE_WSOCKET_SKIP_COMPRESS_MAX_SIZE ? 
  parseInt(process.env.CNODE_WSOCKET_SKIP_COMPRESS_MAX_SIZE, 10) : 10 * 1024 * 1024

let maxPayloadDefault = 104857600
let webSocketMaxPayload = parseInt(process.env.CNODE_WSOCKET_MAX_PAYLOAD || String(maxPayloadDefault))
if (Number.isNaN(webSocketMaxPayload)) {
  webSocketMaxPayload = maxPayloadDefault
}

class WSConnection extends AbstractConnection {

  constructor(coreNodeURL, basePath, userId, password, token, handlers) {
    super(coreNodeURL, basePath, userId, password, token);
    this.handlers = handlers;

    this.sessionTable = {};
    this._initMountMap();
    this.proxies = {};
    this.waiters = []

    this.socketioStatus = "disconnect"
    this.initializeErrorCallback = null
  }

  _open(){
    if (this.denySocketProcess) {
      throw new Error("Can't use socket from disconnect listener")
    }
    var isRespond = false;
    return Promise.resolve()
    .then(()=>{
      return new Promise((res, rej)=>{/*eslint-disable-line no-unused-vars*/
        this.initializeErrorCallback = rej
        if (this.socket != null) {
          if (this.isConnected) {
            //already opened
            return Promise.resolve()
          }
          if (this.socketioStatus === "connect") {
            this.logger.info("connection has already connected but initializing process has not completed");
          } else {
            this.logger.warn("wait for reconnect");
          }
          return new Promise((resolve, reject) => {/*eslint-disable-line no-unused-vars*/
            this.logger.warn("notified (re)connecting + registering");
            this.waiters.push(resolve)
          })
        }
        var initSocket = ()=>{
          this.logger.warn(`Start to open websocket connection for core-node`);
          var s = ioClient(this.coreNodeURL,{
            path : this.basePath + webSocketPath,
            extraHeaders : this.createAuthorizationHeaders(this.userId, this.password, this.token),
            forceNew : true,
            transportOptions: {
              "websocket": {
                maxPayload: webSocketMaxPayload
              }
            }
          });
          const setStatusToConnect = () =>{
            this.socketioStatus = "connect"
            this.denySocketProcess = false
          }
          const setStatusToDisconnect = (reason) => {
            this.socketioStatus = "disconnect"
            if (reason === "io client disconnect") {
              //Disable using socket from disconnect listener when client is shutting down
              this.denySocketProcess = true
            }
            if (this.registerTimerId != null) {
              clearTimeout(this.registerTimerId)
              this.registerTimerId = null
            }
          }
          s.on('connect', ()=>{
            this.logger.warn(`connected to core-node via websocket`);
            setStatusToConnect()
            this.initializeErrorCallback = null

            //start clustering
            var doRegister = () => {
              if (this.registerTimerId != null) {
                //Deny duplicated
                this.logger.info(`Clear register timer`);
                clearTimeout(this.registerTimerId)
                this.registerTimerId = null
              }
              this.register()
                .then(()=>{
                if (this.socketioStatus !== "connect") {
                  throw new Error("Succeeded to register node but socket has already closed")
                }
                this.isConnected = true

                // invoke connect handlers
                this._notifyConnectListener()
                .then(()=> {
                  if (this.handlers.onConnect) {
                    try {
                      this.handlers.onConnect();
                    } catch (e) {
                      this.logger.warn(`Exception occured at onConnect handler.`, e);
                    }
                  }
                  var mountListeners = this.eventListenerForMount["connect"];
                  for (var k in mountListeners) {
                    try {
                      mountListeners[k].map((f)=>f())
                    } catch (e) {
                      this.logger.warn(`Exception occured at onConnect mountListeners.`, e);
                    }
                  }

                  if (!isRespond) {
                    isRespond = true;
                    res();
                  }

                  if (this.waiters.length > 0) {
                    this.waiters.map((waiter) => waiter())
                    this.waiters = []
                  }
                })
              }).catch((e)=> {
                this.logger.warn("Failed to register node", e);
                if (this.socketioStatus === "connect") {
                  if (this.registerTimerId == null) {
                    this.logger.info(`Register timer is set`);
                    this.registerTimerId = setTimeout(() => {
                      this.registerTimerId = null
                      doRegister()
                    }, 30 * 1000 )
                  } else {
                    this.logger.info(`Register timer is already set.`);
                  }
                } else {
                  this.logger.info(`Register timer is not set because current socket status is not 'conneect' ('${this.socketioStatus}').`);
                }
              })
            }
            doRegister()
          });
          const doDisconnect = (reason) => {
            this._notifyDisconnectListener()
            .then(() => {

              //abort session
              var sessions = this.sessionTable
              this.sessionTable = {}
              for (var id in sessions) {
                var session = sessions[id];
                this.logger.warn(`Try to abort session:${id}`);
                try {
                  session.end(Object.assign({}, session.req, {m:{
                    rc: 999
                  }}))
                  this.logger.info(`Succeeded to abort session:${id}`);
                } catch (e) {
                  this.logger.warn(`Failed to abort session:${id}`, e);
                  //IGNORE
                }
              }
              //invoke disconnect handlers
              var mountListeners = this.eventListenerForMount["disconnect"];
              for (var k in mountListeners) {
                try {
                  mountListeners[k].map((f)=>f())
                } catch (e) {
                  this.logger.warn(`Exception occured at onDisconnect mountListeners.`, e);
                }
              }

              if (this.handlers.onDisconnect) {
                try {
                  this.handlers.onDisconnect();
                } catch (e) {
                  this.logger.warn(`Exception occured at onDisconnect handler.`, e);
                }
              }

              //io-client gives up retrying when server disconnected
              if (reason === "io server disconnect") {
                this.socket.connect()
              }
            })
          }
          const onDisconnect = (reason) => {
            this.logger.warn(`disconnected to core-node via websocket. Reason:${reason}`);
            let currentStatus = this.socketioStatus
            setStatusToDisconnect(reason)
            if (currentStatus === "connect") {
              this.logger.info(`Change socketioStatus from ${currentStatus} to ${this.socketioStatus}, we invoke disconnect handler`);
              doDisconnect(reason)
            } else {
              this.logger.info(`Current socketioStatus = ${currentStatus}, we skip disconnect handler`);
            }
          }
          s.on('disconnect', (r, d)=>onDisconnect(`${r}:from disconnect event:${d?JSON.stringify(d):"no description"}`))
          s.on('connect_error', (e)=>onDisconnect(e ? e.message : "connect_error"))
          s.on(webSocketMsgName, (msg) =>{
            this._receive(msg).then(() => {
              this.logger.debug("Succeeded to process received websocket message")
            }).catch((e)=>{
              this.logger.error("Failed to process received websocket message", e);
            });
    
          });
          // Manager events
          // https://socket.io/docs/v3/migrating-from-2-x-to-3-0/#the-socket-instance-will-no-longer-forward-the-events-emitted-by-its-manager
          s.io.on('reconnect', (attempt)=>{
            this.logger.info(`WS Manager.reconnect(attempt:${attempt})`);
          })
          s.io.on('reconnect_error', (e)=>{
            this.logger.error(`Manager.reconnect_error: message='${e.message}', name=${e.name}`);
          })
          s.io.on('reconnect_failed', ()=>{
            this.logger.error(`WS Manager.reconnect_failed`);
          })
          s.io.on('error', (e)=>{
            this.logger.error(`Manager.error: message='${e.message}', name=${e.name}`);
          })
          return s;
        }
        this.socket = initSocket();
      })
    })
  }
  
  _putEventListener4Mounting(event, id, func) {
    if (typeof func !== "function") return;
    this.eventListenerForMount[event][id] = this.eventListenerForMount[event][id] || [];
    this.eventListenerForMount[event][id].push(func)
  }

  _initMountMap() {
    this.mountIdMap = {};
    this.eventListenerForMount = {
      "connect" : {},
      "disconnect" : {}
    };
  }

  mount(path, mode, proxy, option, isRemount) {
    var key = uuidv4();
    return Promise.resolve()
      .then(()=>this.ask(this._createRequestMsg(key, "ProxyService", "mount", {path,mode,option:{
        skipCompress : webSocketSkipCompress
      }})))
      .then((resp) => {
        this._checkResponse(resp, "mount", "mountResponse", ["mountId"]);
        var mountId = resp.m.mountId;
        this.logger.info("Succeeded to mount:%s, %s, %s", path, mode, mountId);
        this.proxies[mountId] = proxy;
        return mountId;
    })
    .then((mountId)=>{
      if (isRemount) {
        return mountId;
      }
      this.mountIdMap[mountId] = {mountId,path, mode, proxy, option};
      this._putEventListener4Mounting("disconnect", mountId, option.onDisconnect,);
      this._putEventListener4Mounting("connect", mountId, option.onReconnect);
      if (option.remount == null || option.remount) {
        this._putEventListener4Mounting("connect", mountId, ((k)=>()=>this._remount(k))(mountId));
      }      
      return mountId;
    })
  }

  _remount(key) {
    var prev = this.mountIdMap[key];
    if (prev == null) {
      this.logger.warn("Failed to remount. mount information for key '" + key + "' is not found.");
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(()=>this.unmount(key, true))
      .then(()=>this.mount(prev.path, prev.mode, prev.proxy, prev.option, true))
      .then((newMountId)=>prev.mountId = newMountId)
      .then(()=>{
        if (prev.option.onRemount) {
          try {
            prev.option.onRemount(key);
          } catch (e) {
            this.logger.warn("remount callback error", e);
            //IGNORE
          }
        }
      })
  }

  unmount(handle, isRemount) {
    if (this.mountIdMap[handle] == null) {
      this.logger.warn("mount handle not found:" + handle);
      return Promise.resolve();
    }
    var realHandle = this.mountIdMap[handle].mountId;
    var key = uuidv4();
    return Promise.resolve()
      .then(()=>this.ask(this._createRequestMsg(key, "ProxyService", "unmount", {mountId:realHandle})))
      .then((resp) => {
        this._checkResponse(resp, "unmount", "unmountResponse");
        this.logger.info("Succeeded to unmount:%s", handle + "(" + realHandle + ")");
        delete this.proxies[realHandle];
    })
    .then(()=>{
      if (isRemount) {
        return ;
      }
      delete this.eventListenerForMount["connect"][handle]
      delete this.eventListenerForMount["disconnect"][handle]
      delete this.mountIdMap[handle] ;
    })
  }

  unmountAll() {
    var targets = Object.keys(this.mountIdMap);
    return Promise.resolve()
      .then(()=>targets.reduce((p,k)=>{
        return p.then(()=>this.unmount(k))
                .catch(()=>this.unmount(k))
      }, Promise.resolve()))
      .then(()=>this._initMountMap())
  }
  
  register() {
    return Promise.resolve()
      .then(()=>{

      var uuid = this.nodeId || uuidv4();
      this.logger.info(`Try to register cluster: ${uuid}`);
      return this.ask(this._createRequestMsg(uuid, "ClusterService", "register"))
        .then((resp)=>{
          if (resp.m && resp.m.rc === 400) {
            this.logger.warn("Node has been already registered(request may be duplicated)");
          } else {
            this._checkResponse(resp, "register", "registerResponse");
            this.logger.info(`Succeeded to register cluster(${uuid})`);
          }
          this.nodeId = uuid;
          this.userInfo = resp.u || {};
        });
    });
  }

  unregister() {
    return Promise.resolve()
      .then(()=>{
        if (this.socket == null || !this.socket.connected) {
          return Promise.resolve();
        }
        var uuid = uuidv4();
        return this.ask(this._createRequestMsg(uuid, "ClusterService", "unregister"))
          .then((resp)=>{
            try {
              this._checkResponse(resp, "unregister", "unregisterResponse");
            } catch (e) {
              //IGNORE
            }
            this.logger.info(`Succeeded to unregister cluster(${this.nodeId}`);
            return Promise.resolve();
          });
      })
  }

  ask(msg) {
    return new Promise((resolve, reject)=>{/*eslint-disable-line no-unused-vars*/
      this.sessionTable[msg.i] = {
        end : (resp)=>{
          resolve(resp);
        },
        req : msg
      }
      Promise.resolve()
        .then(()=>this.send(Object.assign({a : true}, msg)))
        .catch((e)=>reject(e))
    });
    
  }

  send(msg) {
    const compressOpt = (msg.o && msg.o.skipCompress) ? false : true
    return Promise.resolve()
      .then(()=>{
        if (this.socket == null || !this.socket.connected) {
          throw new Error("Socket closed")
        }
        this.socket.compress(compressOpt).emit(webSocketMsgName, msg)
      });
  }
  
  _close() {
    if (this.tokenTimerId != null) {
      clearTimeout(this.tokenTimerId);
    }
    return Promise.resolve()
      .then(()=>this.unregister())
      .then(()=>this._closeSocket())
  }

  _closeSocket() {
    return Promise.resolve()
      .then(()=>{
        var sock = this.socket;
        if (!sock) {
          return;
        }
        this.socket = null;
        sock.close();
        if (this.initializeErrorCallback != null) {
          this.initializeErrorCallback("socket closed")
        }
      });
  }
  
  _receive( msg) {
    return Promise.resolve()
    .then(()=>{
      var isAsk = msg.a;
      if (isAsk && this.sessionTable[msg.i]) {
        //response
        var session = this.sessionTable[msg.i];
        delete this.sessionTable[msg.i];
        session.end(msg);
        return;
      }
      //request
      return new Promise((resolve, reject)=>{
        if (msg.s && msg.s.indexOf("ProxyService:/") === 0 && msg.t !== "request") {
          this.logger.error("unexpected service(%s) and type(%s)", msg.s, msg.t);
          return;
        }
        var req = new WSRequest(msg);
        var resp = new WSResponse(msg, req);

        var proxy = this.proxies[msg.m.mountId];
        if (!proxy) {
          this.logger.warn("proxy instance not found");
          resp.status(404).end();
          this._answerResponse(msg, resp).then(()=>resolve()).catch((e)=>reject(e));
          return;
        }
        var promise = proxy.onReceive(req, resp);
        if (promise == null) {
          this._answerResponse(msg, resp).then(()=>resolve()).catch((e)=>reject(e));
          return;
        }
        promise.then((resp2)=>{
          if (!resp2) {
            this.logger.warn("Response is empty");
            resp.status(500).end();
            return this._answerResponse(msg, resp);
          }
          return this._answerResponse(msg, resp2);
        }).then(() => {
          resolve();
        }).catch((e)=>{
          reject(e);
        });
      })
    })
  }

  _answerResponse(msg, resp) {
    var copyResp = {};
    WSResponse.copyTo(copyResp, resp);
    const skipCompress = (msg.o && 
                        msg.o.skipCompress && 
                        webSocketSkipCompress && 
                        resp.body &&
                        resp.body.length != null &&
                        resp.body.length < webSocketSkipCompressMaxSize)
    return this.send(Object.assign({}, msg, {
      m : copyResp,
      t : "response",
      o : Object.assign({}, msg.o, {
        skipCompress
      })
    }));
  }
  
  _createRequestMsg(id, service, type, msg) {
    return {
      i : id,
      s : service,
      t : type,
      m : msg
    }
  }

  _checkResponse(resp, operationName, expectedType, requiredProps) {
    try {
      if (!resp) {
        throw new Error("Failed to "+operationName+". Response is empty");
      }
      if (resp.t !== expectedType) {
        throw new Error("Failed to "+operationName+". Received unexpected type:" + resp.t);
      }
      var msg = resp.m;
      if (!msg || msg.rc !== 0) {
        throw new Error("Failed to "+operationName+". Received unexpected code:" + (msg && msg.rc));
      }
      if (requiredProps != null) {
        requiredProps.forEach((p)=>{
          if (msg[p] == null) {
            throw new Error("Failed to "+operationName+". Required property('" + p + "') is not found");
          }
        })
      }
    } catch (e) {
      this.logger.error(e.message, JSON.stringify(resp));
      throw e;
    }
  }
}
export default WSConnection