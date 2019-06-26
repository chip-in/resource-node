import Logger from '../util/logger';
import AsyncLock from 'async-lock'

const SEMAPHORE_KEY_NAME = "instance-level-lock";

class ConnectionLogger extends Logger{
  constructor(category, coreNodeURL) {
    super(category);
    this.coreNodeURL = coreNodeURL;
    this.delegate = new Logger(category);
  }
  _log(name, args) {
    args = Array.prototype.slice.call(args)
    args[0] = "("+this.coreNodeURL+")" + args[0];
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

  constructor(coreNodeURL, userId, password, token) {
    this.isConnected = false;
    this.logger = new ConnectionLogger(this.constructor.name || "AbstractConnection", coreNodeURL);
    this.coreNodeURL = coreNodeURL;
    this.userId = userId;
    this.password = password;
    this.token = token;
    this.isConnecting = false;
    this.waiters = [];
    this.lock = new AsyncLock();
  }

  ensureConnected() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(SEMAPHORE_KEY_NAME, ()=>{
        if (this.isConnected) {
          return;
        }
        return Promise.resolve()
          .then(()=>this._open())
          .then(()=>this.isConnected = true)
      }))
  }

  open() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(SEMAPHORE_KEY_NAME, ()=>{
        if (this.isConnected) {
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=>this._open())
          .then(()=>this.isConnected = true)
      }))
  }

  _open() {
    throw new Error("connect function is not implemented");
  }

  close() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(SEMAPHORE_KEY_NAME, ()=>{
        if (!this.isConnected) {
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=>this._close())
          .then(()=>this.isConnected = false);
      }))
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
      headers['Authorization'] = 'Basic ' + new Buffer(userId + ":" + passwd).toString("base64");
    }
    return headers;
  }
  
  setToken(token) {
    this.token = token;
  }

  _getConnectionLockKey() {
    return SEMAPHORE_KEY_NAME;
  }
}

export default AbstractConnection