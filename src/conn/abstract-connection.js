import Logger from '../util/logger';
import AsyncLock from 'async-lock'
import uuidv4 from 'uuid/v4';

const SEMAPHORE_KEY_NAME = "instance-level-connection-lock";
const SUSPEND_ERROR_MESSAGE = "Connection temporarily disabled"

class ConnectionLogger extends Logger{
  constructor(category, coreNodeURL, basePath) {
    super(category);
    this.coreNodeURL = coreNodeURL;
    this.delegate = new Logger(category);
    this.basePath = basePath;
    this.loggerInstanceId = uuidv4()
  }
  _log(name, args) {
    args = Array.prototype.slice.call(args)
    args[0] = "("+this.coreNodeURL+this.basePath+")" + `(${this.loggerInstanceId})` + args[0];
    this.delegate[name].apply(this.delegate, args);
  }
  debug()  {
    this._log("debug", arguments)
  }
  info()  {
    this._log("info", arguments)
  }
  warn()  {
    this._log("warn", arguments)
  }
  error()  {
    this._log("error", arguments)
  }
}
class AbstractConnection {

  constructor(coreNodeURL, basePath, userId, password, token) {
    this.isConnected = false;
    this.basePath = basePath || "";
    this.logger = new ConnectionLogger(this.constructor.name || "AbstractConnection", coreNodeURL, this.basePath);
    this.coreNodeURL = coreNodeURL;
    this.userId = userId;
    this.password = password;
    this.token = token;
    this.isConnecting = false;
    this.waiters = [];
    this.lock = new AsyncLock();

    this.connectEventListeners = {}
    this.disconnectEventListeners = {}

    this.suspened = false

    this.stopOpenProcess = false
  }

  ensureConnected() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this._getConnectionLockKey(), ()=>{
        if (this.isConnected) {
          return;
        }
        return Promise.resolve()
          .then(()=>this._open())
          .then(()=>this.isConnected = true)
      }))
      .catch((e) => {
        this.logger.error("Failed to ensure connected", e)
        throw e
      })
  }

  open() {
    this.logger.info("Try to open connection")
    return Promise.resolve()
      .then(()=>this.lock.acquire(this._getConnectionLockKey(), ()=>{
        if (this.isConnected) {
          return Promise.resolve();
        }
        let shutdownMonitor = setInterval(()=> {
          if (this.stopOpenProcess) {
            this.logger.warn("stopOpenProcess is true")
            this._close()
            clearMonitor()
          }
        }, 1000)
        const clearMonitor = () => {
          if (shutdownMonitor != null) {
            clearInterval(shutdownMonitor)
            shutdownMonitor = null
          }
        }
        return Promise.resolve()
          .then(()=>this._open())
          .then(()=>{
            this.isConnected = true
            clearMonitor()
          }).catch((e) => {
            clearMonitor()
            throw e
          })
      }))
      .catch((e) => {
        this.logger.error("Failed to open connection", e)
        throw e
      })
  }

  _open() {
    throw new Error("connect function is not implemented");
  }

  close() {
    this.logger.info("Try to close connection")
    this.stopOpenProcess = true
    return Promise.resolve()
      .then(()=>this.lock.acquire(this._getConnectionLockKey(), ()=>{
        if (!this.isConnected) {
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=>this._close())
          .then(()=>{
            this.isConnected = false
            this.stopOpenProcess = false
          })
      }))
      .catch((e) => {
        this.logger.error("Failed to close connection", e)
        this.stopOpenProcess = false
        throw e
      })
  }

  _close() {
    throw new Error("disconnect function is not implemented");
  }

  isConnected() {
    return this.isConnected;
  }

  createAuthorizationHeaders(userId, passwd, jwt) {
    var headers = {};
    if (jwt != null) {
      headers['Authorization'] = 'Bearer ' + jwt;
    } else if (userId != null && passwd != null) {
      headers['Authorization'] = 'Basic ' + Buffer.from(userId + ":" + passwd).toString("base64");
    }
    return headers;
  }
  
  setToken(token) {
    this.token = token;
  }

  _getConnectionLockKey() {
    return SEMAPHORE_KEY_NAME;
  }

  addConnectEventListener(listener) {
    return this._addListener(this.connectEventListeners, listener)
  }

  removeConnectEventListener(listenerId) {
    this._removeListener(this.connectEventListeners, listenerId)
  }

  addDisconnectEventListener(listener) {
    return this._addListener(this.disconnectEventListeners, listener)
  }

  removeDisconnectEventListener(listenerId) {
    this._removeListener(this.disconnectEventListeners, listenerId)
  }

  _addListener(dst, listener) {
    var listenerId = uuidv4();
    dst[listenerId] = listener
    return listenerId
  }

  _removeListener(dst, id) {
    delete dst[id]
  }

  _notifyConnectListener() {
    return this._notifyListener(this.connectEventListeners)
  }

  _notifyDisconnectListener() {
    return this._notifyListener(this.disconnectEventListeners)
  }

  _notifyListener(targets) {
    if (targets != null && typeof targets === "object") {
      return Object.values(targets).reduce((promise, listener) => {
        return promise.then(()=>listener())
        .catch((e)=> this.logger.warn("Failed to execute listener", e))
      }, Promise.resolve())
    }
    return Promise.resolve()
  }

  copyListenerTo(target) {
    target.connectEventListeners = this.connectEventListeners
    target.disconnectEventListeners = this.disconnectEventListeners
  }

  setSuspended(suspend) {
    this.suspened = suspend
  }

  raiseSuspended() {
    if(this.suspened) {
      throw new Error(SUSPEND_ERROR_MESSAGE)
    }
  }

  isSuspendError(e) {
    return e instanceof Error && e.message === SUSPEND_ERROR_MESSAGE
  }
}

export default AbstractConnection