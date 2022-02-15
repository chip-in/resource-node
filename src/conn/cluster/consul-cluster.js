import Cluster from './cluter';
import Logger from '../../util/logger';
import {URL, resolve} from 'url';
import AbortController from 'abort-controller';
import AsyncLock from 'async-lock'
import Connection from '../connection';
import objectHash from 'object-hash';

const API_PATH_TO_RESOLVE_MEMBERS = "/v1/catalog/service/hmr";
const API_PATH_TO_RESOLVE_NODE_KEY = "/v1/agent/self";
const API_PATH_TO_CREATE_SESSION = "/v1/session/create";
const API_PATH_TO_RENEW_SESSION = "/v1/session/renew/:id";
const API_PATH_TO_DELETE_SESSION = "/v1/session/destroy/:id";
const API_PATH_TO_LOCK = "/v1/kv/mounts/:key?acquire=:sessionId";
const API_PATH_TO_RELEASE = "/v1/kv/mounts/:key?release=:sessionId";

const CONSUL_INDEX_HEADER_NAME = "X-Consul-Index";
const CONSUL_BLOCKING_QUERY_TIMEOUT = process.env.CONSUL_BLOCKING_QUERY_TIMEOUT || "50s"
const CONSUL_TOKEN_HEADER_NAME = "X-Consul-Token";
const CONSUL_TOKEN_HEADER_VALUE = process.env.CONSUL_TOKEN_HEADER_VALUE;
const BLOCKINGQUERY_RETRY_INTERVAL = 60 * 1000;
const CONSUL_SESSION_TTL = "30s";
const CONSUL_SESSION_LOCK_DELAY_SECONDS = 10;
const CONSUL_SESSION_RENEW_INTERVAL = 10 * 1000;
const CONSUL_SESSION_RENEW_ERROR_THRESHOLD = 3;

var consulCommonLogger = new Logger("ConsulCommon");

const _setupApiOption = (controller) =>{
  var opts = {
    headers : {}
  };
  if (CONSUL_TOKEN_HEADER_VALUE) {
    opts.headers[CONSUL_TOKEN_HEADER_NAME] = CONSUL_TOKEN_HEADER_VALUE;
  }
  if (controller != null) {
    opts.signal = controller.signal;
  }
  return opts;
}

const _toPutOption = (opts, body)=> {
  opts.method = "PUT";
  if (body != null) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"]  = "application/json; charset=utf-8"
  }
  return opts;
}

const _checkStatus = (resp)=> {
  if(!resp.ok) {
    return resp.text()
    .then((txt)=>consulCommonLogger.error("Http status code is invalid:url:'%s', status:'%s', body: '%s'", resp.url, resp.status, txt))
    .then(()=>{
      throw new Error("HTTP status code is invalid")
    })
  }
  return Promise.resolve(resp)
}

const _appendQuery = (base, index)=> {
  if (index == null) {
    return base;
  }
  var connector = (base.indexOf("?") !== -1) ? "&" : "?"
  return base + connector + "wait=" + CONSUL_BLOCKING_QUERY_TIMEOUT + "&index=" + index;
}

const _toURLObject = (baseConn)=> {
  return new URL(baseConn.coreNodeURL);
}

const _replaceFQDN = (baseConn, targetFQDN)=> {
  var urlObj = _toURLObject(baseConn);
  urlObj.host = urlObj.hostname = targetFQDN;
  return urlObj.href;
}

const _toHref = (conn, path)=> {
  if (path[0] === "/") {
    return resolve(conn.coreNodeURL, path);
  }
  return path
}

const _doPutOperation = (conn, path, body)=> {
  return Promise.resolve()
  .then(()=>_setupApiOption())
  .then((opts)=>_toPutOption(opts, body))
  .then((opts)=>conn.fetch(_toHref(conn, path), opts))
  .then((resp)=>_checkStatus(resp))
  .then((resp)=>resp.json())
}

const _doGetOperation = (conn, path, controller) =>{
  return Promise.resolve()
    .then(()=>_setupApiOption(controller))
    .then((opts)=>conn.fetch(_toHref(conn, path), opts))
    .then((resp)=>_checkStatus(resp))
}

class BlockingQueryInvoker {
  constructor(conn, path) {
    this.index = null;
    this.conn = conn;
    this.path = path;
    this.cblist = [];
    this.logger = new Logger(this.constructor.name);
    this.lock = new AsyncLock();
    this.lockKey = path;
    this.timerId = null;
  }

  init() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (this.initValue != null) {
          return Promise.resolve(this.initValue);
        }
        return this._startQuery(this.index, true)
          .then((body)=>{
            this.initValue = body;
            return body;
          })
      }))
  }

  next(cb) {
    var invoked = false;
    this.cblist.push((body)=>{
      cb(null, body);
      invoked = true;
    });
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (invoked) {
          return;
        }
        return this._startQuery(this.index);
      }))
  }

  _startQuery(index, isInit) {
    this.controller = new AbortController();
    return Promise.resolve()
      .then(()=>_doGetOperation(this.conn, _appendQuery(this.path, index), this.controller))
      .then((resp)=>{
        if (this.stopped) {
          throw new Error("blocking-query(" + this.path + ") has suspended")
        }
        var idx = resp.headers.get(CONSUL_INDEX_HEADER_NAME);
        if (this.index == null) {
          this.index = idx;
          if (isInit) {
            return resp.json();
          }
          return this._startQuery(this.index);
        }
        if (this.index === idx) {
          //retry
          this.logger.debug("blocking-query(" + this.path + ") index has not been changed:" + this.index + "=>" + idx)
          return this._startQuery(this.index);
        }
        if (idx < this.index) {
          //Reset the index if it goes backwards. (https://www.consul.io/api-docs/features/blocking)
          // => reset and retry
          this.logger.info("blocking-query(" + this.path + ") index has been reset:" + this.index + "=>" + idx)
          // we treat it as changed
        } else {
          this.logger.debug("blocking-query(" + this.path + ") index has been changed:" + this.index + "=>" + idx)
        }
        return resp.json()
          .then((body)=>{
            this.controller = null;
            this.index = idx;
            this.isRunning = false;
            this.cblist.map((cb)=>cb(body));
            this.cblist = [];
          })
      })
      .catch((e)=>{
        if (this.finalizer) {
          this.finalizer();
        }
        if (e.name === 'AbortError') {
          this.logger.info("blocking-query(" + this.path + ") was aborted by user's request")
          return;
        }
        this.logger.warn("Failed to blocking-query(" + this.path + ")", e)
        if (isInit) {
          throw e;
        }
        //retry after an interval
        return new Promise((res, rej)=>{
          this.timerId = setTimeout(()=>{
            this._startQuery(this.index)
              .then(res).catch(rej)
          }, BLOCKINGQUERY_RETRY_INTERVAL);
        })
      })
  }
  
  stop() {
    var ret = Promise.resolve();
    if (this.controller != null) {
      ret = ret.then(new Promise((res, rej)=>{
        this.controller.abort();
        this.finalizer = res;
      }))
    }
    if (this.timerId != null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    return ret;
  }
}

class ConsulCluster extends Cluster{

  constructor(onMemberJoin, onMemberLeave, onInitialConnClosed, onLockExpired) {
    super(onMemberJoin, onMemberLeave, onInitialConnClosed, onLockExpired);
  }

  _initialize(initConn) {
    return Promise.resolve()
      .then(()=>this._getInitialConnectionKey(initConn))
      .then((initialConnectionKey)=>{
        this.initialConnectionKey = initialConnectionKey;
        this.initialConnection = this.toConnObject(initialConnectionKey, initConn);
        return Promise.resolve()
          .then(()=>{
            this.memberQueryInvoker = new BlockingQueryInvoker(initConn, API_PATH_TO_RESOLVE_MEMBERS)
            return this.memberQueryInvoker.init();
          })
          .then((body)=>this._parseMembers(body))
          .then((members)=>{
            this.logger.info("Succeeded to find initial members. members=" + JSON.stringify(members));
            this.coreNodeConnections = members.filter((m)=>m.nodeKey !== this.initialConnectionKey).map((m)=>this.toConnObject(m.nodeKey, this._createConnection(m.nodeKey, this.initialConnection.conn)))
            this.previousMembers = members;
            return this._watchMembers();
          })
      })
  }

  _createConnection(clusterNodeId, conn) {
    return new Connection(conn.coreNodeURL, "/" + clusterNodeId, conn.userId, conn.password, conn.token, conn.jwtUpdatepath, {})
  }

  _watchMembers() {
    this.memberQueryInvoker.next((e, body)=>{
      if (this.stopUpdateProcess) {
        return;
      }
      if (e != null) {
        this.logger.warn("Failed to watch members. ", e);
        this.memberWatcherTimer = setTimeout(()=>this._watchMembers(), BLOCKINGQUERY_RETRY_INTERVAL)
        return;
      }
      this._checkDifference(this._parseMembers(body))
        .then(()=>this._watchMembers())
    })
  }
  
  _checkDifference(current) {
    return Promise.resolve()
      .then(()=>{
        if (JSON.stringify(this.previousMembers) === JSON.stringify(current)) {
          return;
        }
        this.logger.info("Detect member's modification. members=" + JSON.stringify(current));
        var newIds = current.map((m)=>m.nodeKey);
        var prevIds = this.previousMembers.map((m)=>m.nodeKey);
    
        var leavedMember = this.previousMembers.filter((m)=>this._hasMemberChanged(newIds, current, m));
        var joinedMember = current.filter((m)=>this._hasMemberChanged(prevIds, this.previousMembers, m));
        var joinedMemberWithoutInitConn = joinedMember.filter((m)=>m.nodeKey !== this.initialConnectionKey)
        if (joinedMember.length !== joinedMemberWithoutInitConn.length) {
          this.logger.info("Detect join event of initial connection(" + this.initialConnectionKey + "). We skip it.");
        }
        return Promise.resolve()
          .then(()=>this._notifyLeavedMember(leavedMember))
          .then(()=>this._notifyJoinedMember(joinedMemberWithoutInitConn))
          .then(()=>this.previousMembers = current)
      })
  }

  _notifyLeavedMember(removed) {
    var ret = Promise.resolve();
    if (removed.length === 0) {
      return ret;
    }
    var leaveFunc = (c)=>Promise.resolve(this.onMemberLeave(c));
    var initConnLeaveFunc = (c)=>Promise.resolve(this.onInitialConnClosed(c));

    for (var i = 0; i < removed.length; i++) {
      var target = removed[i];
      if (target.nodeKey === this.initialConnection.nodeKey) {
        this.logger.warn("Leave event fired and it is for initial connection. nodeKey:" + target.nodeKey);
        ret = ret.then(initConnLeaveFunc(this.getInitConnection()))
        
      } else {
        for (var j = 0; j < this.coreNodeConnections.length; j++) {
          if (target.nodeKey === this.coreNodeConnections[j].nodeKey) {
            this.logger.warn("Leave event fired. nodeKey:" + target.nodeKey);
            ret = ret.then(leaveFunc(this.coreNodeConnections[j].conn))
            this.coreNodeConnections.splice(j, 1);
            break;
          }
        }
      }
    }
    return ret;
  }

  _notifyJoinedMember(added) {
    var ret = Promise.resolve()
    if (added.length === 0) {
      return ret;
    }
    var joinFunc = (k,c)=>Promise.resolve(this.onMemberJoin(c).then(()=>this.coreNodeConnections.push(this.toConnObject(k,c))));
    for (var i = 0; i < added.length; i++) {
      var target = added[i];
      if (target.nodeKey === this.initialConnection.nodeKey) {
        this.logger.warn("Join event fired and it is for initial connection. nodeKey:" + target.nodeKey);
        ret = ret.then(Promise.resolve(this.onMemberJoin(this.getInitConnection())))
      } else {
        this.logger.warn("Join event fired. nodeKey:" + target.nodeKey);
        ret = ret.then((joinFunc(target.nodeKey, this._createConnection(target.nodeKey, this.getInitConnection()))))
      }
    }
    return ret;
  }
  
  _hasMemberChanged(ids, dataset, m) {
    var idx = ids.indexOf(m.nodeKey);
    if (idx === -1) {
      return true;
    }
    // if (dataset[idx].hash !== m.hash) {
    //   return true;
    // }
    return false;
  }

  _parseMembers(body) {
    return body.map((node)=>({hash:objectHash(node), nodeKey:node.ID, name:node.Node}))
  }

  _getInitialConnectionKey(conn) {
    return Promise.resolve()
      .then(()=>_doGetOperation(conn, API_PATH_TO_RESOLVE_NODE_KEY))
      .then((resp)=>resp.json())
      .then((body)=>{
        var ret = body && body.Config && body.Config.NodeID;
        if (ret == null) {
          throw new Error("Failed to resolve node key. unexpected response", JSON.stringify(body));
        }
        this.logger.info("Succeeded to resolve node key. key:" + ret);
        return ret;
      })
  }

  _finalize() {
    var ret = Promise.resolve()
    if (this.memberQueryInvoker != null) {
      ret = ret.then(()=>this.memberQueryInvoker.stop())
    }
    if (this.keyQueryInvoker != null) {
      ret = ret.then(()=>this.keyQueryInvoker.stop())
    }
    if (this.sessionId != null) {
      ret = ret.then(()=>_doPutOperation(this.getInitConnection(), API_PATH_TO_DELETE_SESSION.replace(":id", this.sessionId)))
      .then((result)=>{
        if (!result) {
          this.logger.warn("Failed to delete session. SessionId:" + this.sessionId );
        } else {
          this.logger.info("Succeeded to delete session. SessionId:" + this.sessionId );
        }
        this.sessionId = null
      })
    }
    if (this.renewTimerId != null) {
      clearTimeout(this.renewTimerId);
      this.renewTimerId = null;
    }
    if (this.lockTimer != null) {
      clearTimeout(this.lockTimer);
      this.lockTimer = null;
    }
    return ret
  }

  _acquireLock(key) {
    if (this.sessionId == null) {
      if (this.isSessionInitializing) {
        this.logger.info("Create session process is running."); 
        return new Promise((resolve, reject) => {
          this.sessionIdWaiters.push(() => {
            return this._acquireLock(key)
            .then(resolve)
            .catch(reject)
          })
        })
      }
      this.logger.info("Try to create session"); 
      this.isSessionInitializing = true
      this.sessionIdWaiters = []
      return this._createSession()
        .then(()=>this._acquireLock(key))
        .then(()=> {
          this.isSessionInitializing = false
          var waiters = this.sessionIdWaiters
          this.sessionIdWaiters = []
          waiters.map((waiter) => waiter())
        })
        .catch((e) => {
          this.logger.error("Failed to acquire lock. ", e); 
          this.isSessionInitializing = false
          var waiters = this.sessionIdWaiters
          this.sessionIdWaiters = []
          waiters.map((waiter) => waiter())
          // retry
          return this._acquireLock(key)
        })
    }
    var regKey = this._createKVSKey(key)
    var path = API_PATH_TO_LOCK.replace(":key", regKey).replace(":sessionId", this.sessionId);
    var lockArgs = [this.getInitConnection(), path, {sessionId : this.sessionId}]
    return Promise.resolve()
      .then(()=>_doPutOperation(...lockArgs))
      .then((ret)=>{
        if (ret) {
          this.logger.info("Succeeded to acquire lock. SessionId:" + this.sessionId + ", key:" + regKey); 
          return;
        }
        //fail(1st) => retry after lock-delay seconds
        this.logger.warn("Failed to acquire lock. We retry to acquire lock after " + CONSUL_SESSION_LOCK_DELAY_SECONDS + " seonds. SessionId:" + this.sessionId + ", key:" + regKey);
        return new Promise((res, rej)=>{
          this.lockTimer = setTimeout(()=>{
            this.lockTimer = null;
            res();
          }, CONSUL_SESSION_LOCK_DELAY_SECONDS * 1000)
        })
        .then(()=> this._acquireLock(key))
      })
  }

  _abandonLock(key) {
    if (this.sessionId == null) {
      this.logger.warn("Failed to abandon lock. SessionId not found.");
      return Promise.resolve();
    }
    var regKey = this._createKVSKey(key)
    return Promise.resolve()
      .then(()=>_doPutOperation(this.getInitConnection(), 
        API_PATH_TO_RELEASE.replace(":key", regKey).replace(":sessionId", this.sessionId), {}))
      .then((ret)=>{
        if (!ret) {
          this.logger.warn("Failed to abandon lock. SessionId:" + this.sessionId + ", key:" + regKey);
          //IGNORE
        } else {
          this.logger.info("Succeeded to abandon lock. SessionId:" + this.sessionId + ", key:" + regKey);
        }
      })
  }

  
  _createKVSKey(key) {
    // XXX
    // consul REST API rejects key which starts with 'a' (e.g. /v1/kv/mounts/a/b/c/. decoding issue?)
    return "mountpath_" + encodeURIComponent(key[0] === "/" ? key.substring(1) : key)
  }

  _createSession() {
    // CONSUL_SESSION_RENEW_ERROR_THRESHOLD
    return Promise.resolve()
      .then(()=>_doPutOperation(this.getInitConnection(), API_PATH_TO_CREATE_SESSION, {"TTL" : CONSUL_SESSION_TTL, "LockDelay" : CONSUL_SESSION_LOCK_DELAY_SECONDS + "s"}))
      .then((body)=>{
        if (body.ID == null) {
          throw new Error ("Failed to create session. ID not found.")
        }
        this.sessionId = body.ID;
        this.renewErrorCount = 0;
        this.logger.info("Succeeded to create session. SessionId:" + this.sessionId );
      })
      .then(()=>{
        const handleRenewError = ()=>{
          this.renewErrorCount++;
          if (this.renewErrorCount >= CONSUL_SESSION_RENEW_ERROR_THRESHOLD) {
            this.logger.error("Failed to renew session. Error count exceed threshold. Stop renew process.")
            return Promise.resolve()
              .then(()=>{
                this.sessionId = null;
                return Promise.resolve(this.onLockExpired())
              })
          }
          this.renewTimerId = setTimeout(()=>doRenew(), CONSUL_SESSION_RENEW_INTERVAL)
        }
        var doRenew = ()=>{
          return Promise.resolve()
          .then(()=>{
            if (this.sessionId == null) {
              this.logger.warn("sessionId was lost. Stop renew process.")
              this.renewErrorCount = 0;
              return Promise.resolve();
            }
            return _doPutOperation(this.getInitConnection(), API_PATH_TO_RENEW_SESSION.replace(":id", this.sessionId))
            .then((body)=>{
              if (body == null || body[0] == null) {
                this.logger.error("Failed to renew session. Body is empty.")
                handleRenewError();
                return;
              }
              this.logger.debug("Succeeded to renew session. SessionId:" + this.sessionId );
              this.renewErrorCount = 0;
              //next
              this.renewTimerId = setTimeout(()=>doRenew(), CONSUL_SESSION_RENEW_INTERVAL);
            })
            .catch((e)=>{
              this.logger.error("Failed to renew session. Error detected", e)
              handleRenewError();
              return;
            })
          })
        }
        this.renewTimerId = setTimeout(()=>doRenew(), CONSUL_SESSION_RENEW_INTERVAL);
      })
  }
}

export default ConsulCluster