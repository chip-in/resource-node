import Cluster from './cluter';
import Logger from '../../util/logger';
import {resolve} from 'url';
import AbortController from 'abort-controller';
import Connection from '../connection';
import objectHash from 'object-hash';
import { createLock } from '../../util/lock'

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
const CONSUL_SESSION_CREATE_RETRY_INTERVAL = 1 * 1000;
const CONSUL_SESSION_RENEW_INTERVAL = 10 * 1000;
const CONSUL_SESSION_RENEW_ERROR_THRESHOLD = 3;

const RECONNECT_RETRY_TIMES = 10
const RECONNECT_RETRY_INTERVAL = 10 * 1000

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
    this.lock = createLock();
    this.lockKey = path;
    this.timerId = null;
  }

  get() {
    return Promise.resolve()
      .then(()=>this._startQuery())
      .then((ret)=> ret != null ? ret.body : null)
  }

  next() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        const parseQueryResult = (ret) => {
          if (ret == null) {
            // request is aborted
            return null
          }
          let {index, body} = ret
          this.index = index;
          return body
        }
        const handleError = (e) => {
          this.logger.warn("Failed to search next value", e)
          return new Promise((resolve, reject)=> {/*eslint-disable-line no-unused-vars*/
            let isResolved = false
            let timerId = setTimeout(()=>{
              this.blockingTimerObj = null
              doNextQuery().then((ret)=>{
                if (isResolved) {
                  this.logger.warn("Suceeded to query but promise has already resolved")
                  return
                }
                resolve(ret)
                isResolved = true
              })
            }, BLOCKINGQUERY_RETRY_INTERVAL);
            this.blockingTimerObj = {
              timerId,
              onCanceled: () => {
                if (isResolved) {
                  this.logger.warn("Blocking query is canceled but promise has already resolved")
                  return
                }
                this.logger.warn("Blocking query is canceled")
                resolve(null)
                isResolved = true
              }
            }
          })
        }
        const doNextQuery = () => {
          return this._startQuery(this.index)
            .then((ret) => parseQueryResult(ret))
            .catch((e) => handleError(e))
        }
        return doNextQuery()
      }))
  }

  _startQuery(requestedIndex) {
    this.controller = new AbortController();
    return Promise.resolve()
      .then(()=>_doGetOperation(this.conn, _appendQuery(this.path, requestedIndex), this.controller))
      .then((resp)=>{
        if (this.stopped) {
          throw new Error("blocking-query(" + this.path + ") has suspended")
        }
        var idx = resp.headers.get(CONSUL_INDEX_HEADER_NAME);
        if (requestedIndex == null) {
          return resp.json()
            .then((body)=>{
              return {
                index: idx,
                body
              }
            })
        }
        if (requestedIndex === idx) {
          //retry
          this.logger.debug("blocking-query(" + this.path + ") index has not been changed:" + requestedIndex + "=>" + idx)
          return this._startQuery(requestedIndex);
        }
        if (idx < requestedIndex) {
          //Reset the index if it goes backwards. (https://www.consul.io/api-docs/features/blocking)
          // => reset and retry
          this.logger.info("blocking-query(" + this.path + ") index has been reset:" + requestedIndex + "=>" + idx)
          // we treat it as changed
        } else {
          this.logger.debug("blocking-query(" + this.path + ") index has been changed:" + requestedIndex + "=>" + idx)
        }
        return resp.json()
          .then((body)=>{
            this.controller = null;
            return {
              index: idx,
              body
            }
          })
      })
      .catch((e)=>{
        if (this.finalizer) {
          this.finalizer();
        }
        if (e.name === 'AbortError' || e.message === "abort error") {
          this.logger.info("blocking-query(" + this.path + ") was aborted by user's request")
          return null;
        }
        this.logger.warn("Failed to blocking-query(" + this.path + ")", e)
        //retry after an interval
        throw e
      })
  }
  
  stop() {
    var ret = Promise.resolve();
    if (this.controller != null) {
      ret = ret.then(new Promise((res, rej)=>{/*eslint-disable-line no-unused-vars*/
        this.controller.abort();
        this.finalizer = res;
      }))
    }
    if (this.blockingTimerObj != null) {
      clearTimeout(this.blockingTimerObj.timerId);
      this.blockingTimerObj.onCanceled()
      this.blockingTimerObj = null;
    }
    return ret;
  }
}

class ConsulCluster extends Cluster{

  constructor(onMemberJoin, onMemberLeave, onInitialConnClosed, onLockExpired) {
    super(onMemberJoin, onMemberLeave, onInitialConnClosed, onLockExpired);
    this.lockTimer = []
  }

  _initialize(initConn) {
    this.logger.info("Try to initialize cluster");
    this.stopRenew = false
    return Promise.resolve()
      .then(()=>this._getInitialConnectionKey(initConn))
      .then((initialConnectionKey)=>{
        this.logger.info(`Initialize cluster with key(${initialConnectionKey})`);
        this.initialConnectionKey = initialConnectionKey;
        this.initialConnection = this.toConnObject(initialConnectionKey, initConn);
        return Promise.resolve()
          .then(()=>{
            this.memberQueryInvoker = new BlockingQueryInvoker(initConn, API_PATH_TO_RESOLVE_MEMBERS)
            return this.memberQueryInvoker.get();
          })
          .then((body)=>{
            if (body == null) {
              throw new Error("Failed to get consul-member")
            }
            return this._parseMembers(body)
          })
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
    this.memberQueryInvoker.next().then((body)=>{
      // if (e != null) {
      //   if (e.name === 'AbortError' || e.message === "abort error") {
      //     this.logger.warn("Member watching was aborted by user's request")
      //     return ;
      //   }
      //   this.logger.warn("Failed to watch members. ", e);
      //   this.memberWatcherTimer = setTimeout(()=>this._watchMembers(), BLOCKINGQUERY_RETRY_INTERVAL)
      //   return;
      // }
      if (body == null) {
        // request is aborted
        this.logger.warn("Request is aborted. Finished to watch member.");
        return
      }
      const parsedMembers = this._parseMembers(body)
      const applyChanges = (members) => {
        return this._checkDifference(members)
        .catch((e) => {
          this.logger.error(`Failed to apply member's modification.`, e)
          //RETRY
          return new Promise((resolve, reject) => {
            setTimeout(() => {
              applyChanges(members)
              .then(resolve)
              .catch(reject)
            }, RECONNECT_RETRY_INTERVAL)
          })
        })
      }
      applyChanges(parsedMembers)
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
    for (var i = 0; i < removed.length; i++) {
      var target = removed[i];
      if (target.nodeKey === this.initialConnection.nodeKey) {
        this.logger.warn("Leave event fired and it is for initial connection. nodeKey:" + target.nodeKey);
        ret = ret.then(() => {
          return Promise.resolve(this.onInitialConnClosed(this.getInitConnection()))
        })
        
      } else {
        for (var j = 0; j < this.coreNodeConnections.length; j++) {
          if (target.nodeKey === this.coreNodeConnections[j].nodeKey) {
            this.logger.warn("Leave event fired. nodeKey:" + target.nodeKey);
            ret = ret.then(((c, idx)=> {
              return () => {
                return Promise.resolve(this.onMemberLeave(c))
                  .then(() => this.coreNodeConnections.splice(idx, 1))
              }
            })(this.coreNodeConnections[j].conn, j))
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
    for (var i = 0; i < added.length; i++) {
      var target = added[i];
      if (target.nodeKey === this.initialConnection.nodeKey) {
        this.logger.warn("Join event fired and it is for initial connection. nodeKey:" + target.nodeKey);
        ret = ret.then(() => {
          const c = this.getInitConnection()
          return Promise.resolve(this.onMemberJoin(c))
        })
      } else {
        this.logger.warn("Join event fired. nodeKey:" + target.nodeKey);
        ret = ret.then((k=> {
          return () => {
            const c = this._createConnection(k, this.getInitConnection())
            return Promise.resolve(this.onMemberJoin(c))
              .then((()=>this.coreNodeConnections.push(this.toConnObject(k,c))))
          }
        })(target.nodeKey))
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

  _finalize(closeAll) {
    var ret = Promise.resolve().then(()=>this._stopWathingMemberChanges())
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
    if (closeAll) {
      ret = ret.then(()=>this.waterfall((c)=>c.close()))
        .then(()=>this.logger.info("Succeeded to close all connections"))
        .catch((e) => {
          this.logger.error("Failed to close connection", e)
          //IGNORE
        })
    }
    ret = ret.then(()=> {
      //cleanup
      this._stopRenewTimer()
      this._stopLockTimer()
      this.initialConnectionKey = null
      this.initialConnection = null
      this.coreNodeConnections = []
    })
    return ret
  }

  _acquireLock(key, oneshot) {
    if (this.sessionId == null) {
      if (this.isSessionInitializing) {
        this.logger.info("Create session process is running."); 
        return new Promise((resolve, reject) => {
          this.sessionIdWaiters.push(() => {
            return this._acquireLock(key, oneshot)
            .then(resolve)
            .catch(reject)
          })
        })
      }
      this.logger.info("Try to create session"); 
      this.isSessionInitializing = true
      this.sessionIdWaiters = []
      return this._createSession()
        .then(()=>this._acquireLock(key, oneshot))
        .then(()=> {
          this.isSessionInitializing = false
          var waiters = this.sessionIdWaiters
          this.sessionIdWaiters = []
          waiters.map((waiter) => waiter())
        })
        .catch((e) => {
          this.logger.error(`Failed to acquire consul lock (${key})`, e);
          this.isSessionInitializing = false
          var waiters = this.sessionIdWaiters
          this.sessionIdWaiters = []
          waiters.map((waiter) => waiter())
          if (this.isAcquiringCancelError(e)) {
            throw e
          }
          // retry
          return new Promise((resolve, reject) => {
            setTimeout(()=>{
              this._acquireLock(key, oneshot)
                .then(resolve).catch(reject)
            }, CONSUL_SESSION_CREATE_RETRY_INTERVAL)
          })
        })
    }
    var regKey = this._createKVSKey(key)
    // var path = API_PATH_TO_LOCK.replace(":key", regKey).replace(":sessionId", this.sessionId);
    // var lockArgs = [this.getInitConnection(), path, {sessionId : this.sessionId}]
    return Promise.resolve()
      .then(()=>_doPutOperation(this.getInitConnection(),
        API_PATH_TO_LOCK.replace(":key", regKey).replace(":sessionId", this.sessionId), {sessionId : this.sessionId}))
      .then((ret)=>{
        if (ret) {
          this.logger.info("Succeeded to acquire lock. SessionId:" + this.sessionId + ", key:" + regKey); 
          return;
        }
        if (oneshot) {
          throw new Error(`Failed to acquire lock for key '${key}'(${regKey}).`)
        }
        //fail(1st) => retry after lock-delay seconds
        this.logger.warn("Failed to acquire lock. We retry to acquire lock after " + CONSUL_SESSION_LOCK_DELAY_SECONDS + " seconds. SessionId:" + this.sessionId + ", key:" + regKey);
        return new Promise((res, rej)=>{/*eslint-disable-line no-unused-vars*/
          let timerId = setTimeout(()=>{
            this.lockTimer = this.lockTimer.filter(obj => obj.timerId != timerId)
            this._acquireLock(key, oneshot)
            .then(res)
            .catch(rej)
          }, CONSUL_SESSION_LOCK_DELAY_SECONDS * 1000)
          this.lockTimer.push({timerId, onCanceled: () => {
            rej(new Error(this.getAcquiringCancelMessage()))
          }})
        })
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
      .then(()=>this._setRenewTimer())
  }

  _handleRenewError() {
    this.renewErrorCount++;
    if (this.renewErrorCount >= CONSUL_SESSION_RENEW_ERROR_THRESHOLD) {
      this.logger.error("Failed to renew session. Error count exceed threshold. Stop renew process.")
      return Promise.resolve()
        .then(()=>{
          this.sessionId = null;
          return Promise.resolve(this.onLockExpired())
        })
    }
    return Promise.resolve()
    .then(() => this._setRenewTimer())
  }

  _setRenewTimer() {
    if (this.stopRenew) {
      this.logger.warn("Renew session timer is suspended.")
      return
    }
    this.renewTimerId = setTimeout(()=>this._doRenew(), CONSUL_SESSION_RENEW_INTERVAL)
  }

  _doRenew() {
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
          return this._handleRenewError();
        }
        this.logger.debug("Succeeded to renew session. SessionId:" + this.sessionId );
        this.renewErrorCount = 0;
        //next
        return this._setRenewTimer()
      })
      .catch((e)=>{
        this.logger.error(`Failed to renew session. Error detected: message='${e.message}', name=${e.name}`);
        return this._handleRenewError();
      })
    })
  }
  
  _stopWathingMemberChanges() {
    return Promise.resolve()
    .then(()=> {
      if (this.memberQueryInvoker != null) {
        return this.memberQueryInvoker.stop()
      }
      if (this.memberWatcherTimer != null) {
        clearTimeout(this.memberWatcherTimer)
        this.memberWatcherTimer = null
      }
    })
  }

  _stopLockTimer() {
    this.lockTimer.map((obj)=>{
      clearTimeout(obj.timerId)
      obj.onCanceled()
    })
    this.lockTimer = []
  }

  _stopRenewTimer() {
    if (this.renewTimerId != null) {
      clearTimeout(this.renewTimerId)
    }
    this.renewTimerId = null
    this.stopRenew = true
  }

  _suspend() {
    return Promise.resolve()
    .then(()=>this._stopWathingMemberChanges())
    .then(()=>{
      this._stopRenewTimer()
      this._stopLockTimer()
    })
  }

  _checkSessionId(sessionId) {
    return Promise.resolve()
    .then(()=> _doPutOperation(this.getInitConnection(), API_PATH_TO_RENEW_SESSION.replace(":id", sessionId)))
    .then((body)=> {
      if (body == null || body[0] == null) {
        this.logger.info(`Failed to renew session. SessionId is invalid(${sessionId})`)
        return false
      }
      this.logger.info(`Succeeded to renew session. SessionId is valid(${sessionId})`)
      return true
    }).catch((e) => {
      this.logger.info(`Failed to renew session. SessionId is invalid(${sessionId})`, e)
      return false
    })
  }

  _resume() {
    this.stopRenew = false
    return Promise.resolve()
    .then(()=> {
      if (this.memberQueryInvoker == null) {
        throw new Error("AssertionError: Resume is invoked but queryInvoker is not initialized")
      }
      //get members
      const getMembers = (i) => {
        return Promise.resolve()
        .then(()=>this.memberQueryInvoker.get())
        .catch((e)=> {
          this.logger.warn("Failed to get members", e)
          if (i+1 >= RECONNECT_RETRY_TIMES) {
            return null
          }
          return new Promise((resolve, reject)=> {
            setTimeout(()=>{
              getMembers(i+1).then(resolve).catch(reject)
            }, RECONNECT_RETRY_INTERVAL)
          })
        })
      }
      return getMembers(0)
      .then((queryResult)=> {
        if (queryResult == null) {
          throw new Error("Failed to get consul-member")
        }
        //check initialConn exists in consul member
        const members = this._parseMembers(queryResult)
        this.logger.info(`Resume cluster: Succeeded to find consul members: ${JSON.stringify(members)}`);
        const initConnExists = members.filter((m)=>m.nodeKey === this.initialConnectionKey).length > 0
        if (!initConnExists) {
          throw new Error("InitialConnection doesn't exist in consul-member")
        }
        this.logger.info(`Resume cluster: Initial connection(${this.initialConnectionKey}) exists in members`);

        //check sessionId is alive
        if (this.sessionId != null) {
          this.logger.info(`Resume cluster: sessionId is ${this.sessionId}, check sessionId is valid`);
          return this._checkSessionId(this.sessionId)
          .then((isSessionAlive)=> {
            if (isSessionAlive) {
              this.logger.info(`Resume cluster: Set renew timer`);
              return this._setRenewTimer()
              .then(() => this._watchMembers())
              
            } else {
              return this._createSession()
              .then(()=> {
                return Object.keys(this.lockedKey).reduce((promise, key)=> {
                  return promise.then(()=>this._acquireLock(key, true))
                }, Promise.resolve())
              })
              .then(()=>this._watchMembers())
            }
          })
        } else {
          this.logger.info(`Resume cluster: sessionId is null`);
        }
      })
    }).catch((e) => {
      this.logger.error("Failed to resume consul cluster", e)
      throw e

    })
  }

}

export default ConsulCluster