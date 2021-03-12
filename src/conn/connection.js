import {fetchImpl, fetchOption} from '../util/fetch';
import AbstractConnection from './abstract-connection';
import WSConnection from './ws-connection';
import MQTTConnection from './mqtt-connection';

const JWT_MIN_REFRESH_INTERVAL = 30 * 1000;
const JWT_REFRESH_FETCH_OPTS = {
  mode: 'cors',
  credentials: 'include',
  redirect: "follow"
}

class Connection extends AbstractConnection{

  constructor(coreNodeURL, basePath, userId, password, token, jwtUpdatepath, handlers) { 
    super(coreNodeURL, basePath, userId, password, token)
    this.initArgs = Array.prototype.slice.call(arguments);
    this.jwtUpdatepath = jwtUpdatepath;
    this.handlers = handlers || {};
    this.wsConn = new WSConnection(coreNodeURL, basePath, userId, password, token, handlers);
    this.mqttConn = new MQTTConnection(coreNodeURL, basePath, userId, password, token);
  }

  getInitialArgs() {
    return this.initArgs;
  }

  _open() {
    return Promise.resolve()
      .then(()=>this._startJWTRefreshProcess())
      .then(()=>this.wsConn.open())
      .then(()=>this.mqttConn.open())
  }
  
  /*
   * override
   */
  ensureConnected(timeout) {
    return this.wsConn.ensureConnected(timeout)
      .then(()=>this.isConnected = true)
  }

  _close() {
    return Promise.resolve()
      .then(()=>{
        if (this.tokenTimerId != null) {
          clearTimeout(this.tokenTimerId);
        }
      })
      .then(()=>this.mqttConn.close())
      .then(()=>this.wsConn.close())
  }

  isPNConnection() {
    return false;
  }

  fetch(href, option) {
    option = Object.assign({}, fetchOption, option);
    this._normalizeHeader(option);
    this._setAuthorizationHeader(option);
    return fetchImpl(href, option);
  }

  publish(topicName, message) {
    return Promise.resolve()
      .then(()=>this.ensureConnected())
      .then(()=>this.mqttConn.publish(topicName, message))
  }

  subscribe(topicName, subscriber) {
    return Promise.resolve()
      .then(()=>this.ensureConnected())
      .then(()=>this.mqttConn.subscribe(topicName, subscriber))
  }

  unsubscribe(key) { 
    return Promise.resolve()
      .then(()=>this.ensureConnected())
      .then(()=>this.mqttConn.unsubscribe(key))
  }

  unsubscribeAll() {
    return Promise.resolve()
    .then(()=>this.mqttConn.unsubscribeAll())
  }
  

  mount(path, mode, proxy, option) {
    return Promise.resolve()
    .then(()=>this.wsConn.mount(path, mode, proxy, option))
  }

  unmount(handle) {
    return Promise.resolve()
    .then(()=>this.wsConn.unmount(handle))
  }
  
  unmountAll() {
    return Promise.resolve()
    .then(()=>this.wsConn.unmountAll())
  }

  _normalizeHeader(option) {
    if (option == null) {
      return;
    }
    var headers = option.headers;
    if (!headers) {
      headers = option.headers = {};
    }
    var tmp = {};
    //convert to native object
    if (typeof headers.getAll === "function") {
      tmp = {};
      for (var k in Object.keys(headers)) {
        var val = headers.getAll(k);
        tmp[k] = val.length > 1 ? val : val[0];
      }
    } else if (headers && typeof headers === "object" ) {
      tmp = Object.assign(tmp, headers);
    }
    option.headers = tmp;
  }

  _setAuthorizationHeader(option) {
    if (option == null) {
      return;
    }
    var ret = this.createAuthorizationHeaders(this.userId, this.password, this.token);
    if (!option.headers) {
      option.headers = ret;
    } else {
      option.headers = Object.assign(option.headers, ret);
    }
  }
  
  _startJWTRefreshProcess() {
    return Promise.resolve()
    .then(()=>{
      if (this.isRefreshRunning || this.token == null) {
        return;
      }
      this.isRefreshRunning = true;
      var path = this.jwtUpdatepath || "/core.JWTUpdate"
      if (path.indexOf("/") !== 0) {
        path = "/" + path;
      }
      var url = this.coreNodeURL + path;
      try {
        if (this._decodeJwt(this.token).exp < this._getNow()) {
          this.logger.info("token is expired, so reload now");
          return Promise.resolve()
            .then(()=>this._refreshToken(url))
            .catch((e)=>{
              this.logger.error("Failed to refresh initial token. You may fail to connect core-node. Caused by:", e)
            })
        }
        this._setJWTTimer(this.token, url);
      } catch (e) {
        this.logger.error("Failed to start JWT refresh process", e)
      }
    })
  }

  _refreshToken(url) {
    return this.fetch(url, JWT_REFRESH_FETCH_OPTS)
      .then(function(response) {
        if (response.status == 401) {
          return Promise.reject("invalid session");
        } else if (! response.ok) {
          return Promise.reject("Failed to refresh token:" +  response.statusText);
        }
        return response.json();
      })
      .then(result => {
        this._updateToken(result.access_token)
        this.logger.info("Succeeded to refresh token:")
        this._setJWTTimer(result.access_token, url);
      })
      .catch((e) => {
        this.logger.error("fail! reason=" + e);
        throw e;
      });
  }
  _updateToken(token) {
    this.setToken(token);
    if (typeof this.handlers.onTokenUpdate === "function" ) {
      this.handlers.onTokenUpdate(token);
    }
  }

  setToken(token) {
    this.token = token;
    this.wsConn.setToken(token);
    this.mqttConn.setToken(token);
  }

  _setJWTTimer(jwt, url) {
    this.tokenTimerId = setTimeout(()=>this._refreshToken(url), this._calcNextUpdateTime(jwt));
  }

  _getNow() {
    return Math.round(new Date().getTime() / 1000);
  }
  
  _decodeJwt (jwt) {
    return JSON.parse(new Buffer(jwt.split(".")[1], "base64").toString());
  }

  _calcNextUpdateTime(jwt) {
    var token = this._decodeJwt(jwt);
    var now = this._getNow();
    this.logger.info("current time = " + now + " token.exp = " + token.exp);
    var timeout = (token.exp - now - 60) * 1000;
    return timeout > JWT_MIN_REFRESH_INTERVAL ? (timeout > 0x7FFFFFFF ? 0x7FFFFFFF : timeout) : JWT_MIN_REFRESH_INTERVAL;
  }

  getConnectionId() {
    return this.wsConn.nodeId;
  }

  getUserInformation() {
    return this.wsConn.userInfo;
  }
}
export default Connection;