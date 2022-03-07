import Logger from '../../util/logger';
import AsyncLock from 'async-lock'
import uuidv4 from 'uuid/v4';

const IGNORE_CORENODE_CLUSTERING_ERROR = process.env.IGNORE_CORENODE_CLUSTERING_ERROR || "false";
const ACQUIRE_LOCK_RETRY_INTERVAL = 10 * 1000;
const INITIALIZE_RETRY_INTERVAL = 30 * 1000;

const ACQUIRE_LOCK_CANCEL_MESSAGE = "Acquiring is canceled"

class ConnectionWrapper {
  constructor(nodeKey, conn) {
    this.nodeKey = nodeKey;
    this.conn = conn;
  }
}

class Cluster {

  constructor(onMemberJoin, onMemberLeave, onInitialConnClosed, onLockExpired) {
    this.logger = new Logger(this.constructor.name || "Cluster");
    this.initialConnection = null;
    this.coreNodeConnections = [];
    this.lockedKey = {};
    this.onMemberJoin = onMemberJoin;
    this.onMemberLeave = onMemberLeave;
    this.onInitialConnClosed = onInitialConnClosed;
    this.onLockExpired = ()=>{
      var expiredLockKey = Object.keys(this.lockedKey);
      this.logger.warn("lock-expired event is fired. lockKeys='" + JSON.stringify(expiredLockKey) + "'");
      this.lockedKey = {};
      onLockExpired(expiredLockKey)
    };
    /**
     * stopped,started,suspended
     */
    this.status = "stopped";
    this.lock = new AsyncLock();
    this.lockKey = "instance-level-cluster-lock";

    this.initializeTimer = null
    this.lockingTimerIds = {}
  }

  initialize(initConn) {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (this.status !== "stopped") {
          this.logger.warn("Cluster is already initialized")
          return Promise.resolve();
        }
        this.logger.warn("Try to initialize cluster")
        return Promise.resolve()
          .then(()=>this._initialize(initConn))
          .then(()=>{
            this.logger.info("Succeeded to initialize cluster")
            this.status = "started"
          })
          .catch((e)=>{
            if (IGNORE_CORENODE_CLUSTERING_ERROR === "false") {
              this.logger.error("Failed to initialize cluster", e)
              throw e;
            }
            this.logger.warn("Failed to initialize cluster. Resource-node runs in non-redundant mode", e);
            //IGNORE
            this.initialConnection = this.toConnObject(uuidv4(), initConn)
            this.status = "started"
            this.isNonRedundantMode = true;
          })
      }))
      .catch((e) => {
        this.logger.error("Failed to initialize cluster", e)
        return new Promise((resolve, reject) => {
          this.logger.warn(`Set initialize timer after ${INITIALIZE_RETRY_INTERVAL} ms`)
          let retryFunc = () => {
            this.initializeTimer = null
            this.initialize(initConn)
              .then(() => resolve())
              .catch((e) => reject(e))
          }
          let initializeRetryTimerId = setTimeout(retryFunc, INITIALIZE_RETRY_INTERVAL)
          this.initializeTimer = {initializeRetryTimerId, retryFunc}
        })
      })
  }

  finalize(closeAll) {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (this.status === "stopped") {
          this.logger.warn("Cluster has already stopped")
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=> {
            const keys = this.lockedKey
            this.lockedKey = {}
            return Object.keys(keys).reduce((promise, k) => {
              return promise
                .then(()=>this.abandonLock(k, true))
            }, Promise.resolve())
          })
          .then(()=>this._finalize(closeAll))
          .then(()=>{
            this.status = "stopped"
            this.initializeTimer = null
            this.lockingTimerIds = {}
          })
      }))
  }

  acquireLock(key) {
    if (this.isNonRedundantMode) {
      this.logger.warn("Skip to acquire lock. Resource-node runs in non-redundant mode");
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(()=>this._acquireLock(key))
      .then((ret)=>{
        this.lockedKey[key] = true;
        return ret;
      })
      .catch((e)=>{
        this.logger.error(`Failed to acquire lock(${key})`, e)
        if (this.status !== "started") {
          this.logger.warn(`Status is ${this.status}, we stop acquiring lock`)
          throw e
        }
        return new Promise((res, rej)=>{
          let func = (id) => {
            delete this.lockingTimerIds[id]
            this.acquireLock(key).then(res).catch(rej)
          }
          let timerId = setTimeout(()=>func(timerId), ACQUIRE_LOCK_RETRY_INTERVAL)
          this.lockingTimerIds[timerId] = func
        })
      })
  }

  abandonLock(key, ignoreError) {
    if (this.isNonRedundantMode) {
      this.logger.warn("Skip to abandon lock. Resource-node runs in non-redundant mode");
      return Promise.resolve();
    }
    return Promise.resolve()
      .then(()=>this._abandonLock(key))
      .then((ret)=>{
        delete this.lockedKey[key];
        return ret;
      })
      .catch((e)=>{
        if (ignoreError) {
          this.logger.warn("Failed to abandon lock. We ignore it");
          delete this.lockedKey[key];
          return;
        }
        this.logger.error("Failed to abandon lock", e)
        if (this.status !== "started") {
          this.logger.warn(`Status is ${this.status}, we stop abandoning lock`)
          throw e
        }
        return new Promise((res, rej)=>{
          let func = (id) => {
            delete this.lockingTimerIds[id]
            this.abandonLock(key).then(res).catch(rej)
          }
          let timerId = setTimeout(()=>func(timerId), ACQUIRE_LOCK_RETRY_INTERVAL)
          this.lockingTimerIds[timerId] = func
        })
      })
  }

  suspend() {
    return Promise.resolve()
    .then(()=> {
      if (this.status !== "started") {
        this.logger.info(`current status is ${this.status}, we skip suspending process`);
        return
      }
      this.logger.info(`Try to suspend cluster`);
      if (this.initializeTimer != null) {
        clearTimeout(this.initializeTimer.initializeRetryTimerId)
      }
      for (let lockTimerId in this.lockingTimerIds) {
        clearTimeout(lockTimerId)
      }
      return this._suspend()
        .then(()=>this.status = "suspended")
    })
  }

  resume() {
    return Promise.resolve()
    .then(()=> {
      if (this.status === "started") {
        this.logger.info(`current status is ${this.status}, we skip resuming process`);
        return
      }
      if (this.status === "stopped") {
        if (this.initializeTimer != null) {
          this.logger.info(`current status is ${this.status}, we resume initialize process`);
          let initializeRetryTimerId = setTimeout(this.initializeTimer.retryFunc, INITIALIZE_RETRY_INTERVAL)
          this.initializeTimer.initializeRetryTimerId = initializeRetryTimerId
        } else {
          throw new Error("cluster is not started")
        }
      } else {
        return this._resume()
        .then(()=> {
          const timers = this.lockingTimerIds
          this.lockingTimerIds = {}
          for (let lockTimerId in timers) {
            let func = timers[lockTimerId]
            let newTimerId = setTimeout(()=>func(lockTimerId), ACQUIRE_LOCK_RETRY_INTERVAL)
            this.lockingTimerIds[newTimerId] = func
            this.logger.info(`resume locking timer by ID ${newTimerId}`);
          }
          this.status = "started"
        })
      }
    })

  }

  _initialize(initConn) {/*eslint-disable-line no-unused-vars*/
    throw new Error("not implemented")
  }

  _finalize(closeAll) {/*eslint-disable-line no-unused-vars*/
    throw new Error("not implemented")
  }

  _acquireLock(key) {/*eslint-disable-line no-unused-vars*/
    throw new Error("not implemented")
  }

  _abandonLock(key) {/*eslint-disable-line no-unused-vars*/
    throw new Error("not implemented")
  }

  _suspend() {
    throw new Error("not implemented")
  }

  _resume() {
    throw new Error("not implemented")
  }

  toConnObject(nodeKey, conn) {
    return new ConnectionWrapper(nodeKey, conn);
  }
  
  toList() {
    return [this.initialConnection, ...this.coreNodeConnections]
      .map((connWrapper)=>connWrapper.conn)
  }

  all(func) {
    return Promise.resolve()
      .then(()=>Promise.all(this.toList().map((c)=>Promise.resolve(func(c)))))
  }
  
  waterfall(func, reverse, doAll) {
    return Promise.resolve()
      .then(()=>{
        var targets = this.toList();
        if (reverse) {
          targets = targets.reverse();
        }
        return targets.reduce((p, c)=>{
          return p.then(()=>func(c))
                  .catch((e)=>{
                    this.logger.warn("Exception occurs on waterfall", e);
                    if (doAll) {
                      return;
                    }
                    throw e;
                  })
        }, Promise.resolve())
      })
  }

  one(func) {
    var conn = this.toList()[0];
    if (conn == null) {
      return Promise.reject("connection not available")
    }
    return Promise.resolve()
      .then(()=>func(this.toList()[0]))
  }

  subconnections(func) {
    return Promise.resolve()
      .then(()=>Promise.all(this.coreNodeConnections.map((c)=>Promise.resolve(func(c.conn)))))
  }

  getInitConnection() {
    return this.initialConnection.conn;
  }

  getAcquiringCancelMessage() {
    return ACQUIRE_LOCK_CANCEL_MESSAGE
  }

  isAcquiringCancelError(e) {
    return e instanceof Error && e.message === this.getAcquiringCancelMessage()
  }
}

export default Cluster;