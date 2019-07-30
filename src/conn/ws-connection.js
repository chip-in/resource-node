import ioClient from 'socket.io-client';
import uuidv4 from 'uuid/v4';
import AbstractConnection from './abstract-connection';
import WSResponse from '../conversion/ws-response';
import WSRequest from '../conversion/ws-request';

const webSocketPath = process.env.CNODE_WSOCKET_PATH || '/r';
const webSocketMsgName = process.env.CNODE_WSOCKET_MSG_NAME || 'ci-msg';  

const perMessageDeflate = {
  zlibDeflateOptions : {
    level: 1 /* zlib.constants.Z_BEST_SPEED */,
    chunkSize : 1 * 1024 * 1024
  },
  zlibInflateOptions : {
    chunkSize : 1 * 1024 * 1024
  }
}

class WSConnection extends AbstractConnection {

  constructor(coreNodeURL, basePath, userId, password, token, handlers) {
    super(coreNodeURL, basePath, userId, password, token);
    this.handlers = handlers;

    this.sessionTable = {};
    this._initMountMap();
    this.proxies = {};
  }

  _open(){
    var isRespond = false;
    return Promise.resolve()
    .then(()=>{
      return new Promise((res, rej)=>{
        var initSocket = ()=>{
          var s = ioClient(this.coreNodeURL,{
            path : this.basePath + webSocketPath,
            extraHeaders : this.createAuthorizationHeaders(this.userId, this.password, this.token),
            perMessageDeflate,
            forceNew : true
          });
          s.on('connect', ()=>{
            this.logger.warn("connected to core-node via websocket");
            //start clustering
            this.register()
              .then(()=>{
                if (this.handlers.onConnect) {
                  this.handlers.onConnect();
                }
                var mountListeners = this.eventListenerForMount["connect"];
                for (var k in mountListeners) {
                  mountListeners[k].map((f)=>f())
                }
                if (!isRespond) {
                  isRespond = true;
                  res();
                }
              })
          });
          s.on('reconnect', ()=>{
            this.logger.warn("reconnected to core-node via websocket");
            this.isConnected = true;
          })
          s.on('disconnect', ()=>{
            this.logger.warn("disconnected to core-node via websocket");
            this.isConnected = false;
            if (this.handlers.onDisconnect) {
              this.handlers.onDisconnect();
            }
            var mountListeners = this.eventListenerForMount["disconnect"];
            for (var k in mountListeners) {
              mountListeners[k].map((f)=>f())
            }
          });
          s.on(webSocketMsgName, (msg) =>{
            this._receive(msg);
          });
          s.on('error', (e)=>{
            this.logger.error("error:", e);
          })
          s.on('connect_error', (e)=>{
            this.logger.error("Connection error:", e);
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
      .then(()=>this.ask(this._createRequestMsg(key, "ProxyService", "mount", {path,mode})))
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
      return this.ask(this._createRequestMsg(uuid, "ClusterService", "register"))
        .then((resp)=>{
          this._checkResponse(resp, "register", "registerResponse");
          this.logger.info("Succeeded to register cluster");
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
            this.logger.info("Succeeded to unregister cluster");
            return Promise.resolve();
          });
      })
  }

  ask(msg) {
    return new Promise((resolve, reject)=>{
      this.sessionTable[msg.i] = {
        end : (resp)=>{
          resolve(resp);
        }
      }
      Promise.resolve()
        .then(()=>this.send(Object.assign({a : true}, msg)))
    });
    
  }

  send(msg) {
    return Promise.resolve()
      .then(()=>this.socket.emit(webSocketMsgName, msg));
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
          this._answerResponse(msg, resp);
          resolve();
          return;
        }
        var promise = proxy.onReceive(req, resp);
        if (promise == null) {
          this._answerResponse(msg, resp);
          resolve();
          return;
        }
        promise.then((resp2)=>{
          if (!resp2) {
            this.logger.warn("Response is empty");
            resp.status(500).end();
            this._answerResponse(msg, resp);
            resolve();
            return;
          }
          this._answerResponse(msg, resp2);
          resolve();
        }).catch((e)=>{
          this.logger.error("Failed to proxy service", e);
          reject(e);
        });
      })
    })
  }

  _answerResponse(msg, resp) {
    var copyResp = {};
    WSResponse.copyTo(copyResp, resp);
    this.send(Object.assign({}, msg, {
      m : copyResp,
      t : "response"
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