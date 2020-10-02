import Logger from '../../util/logger';
import AsyncLock from 'async-lock'
import uuidv4 from 'uuid/v4';

const IGNORE_CORENODE_CLUSTERING_ERROR = process.env.IGNORE_CORENODE_CLUSTERING_ERROR || "false";
const ACQUIRE_LOCK_RETRY_INTERVAL = 10 * 1000;

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
    this.isInitialized = false;
    this.lock = new AsyncLock();
    this.lockKey = "instance-level-lock";
  }

  initialize(initConn) {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (this.isInitialized) {
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=>this._initialize(initConn))
          .then(()=>this.isInitialized = true)
          .catch((e)=>{
            if (IGNORE_CORENODE_CLUSTERING_ERROR === "false") {
              this.logger.error("Failed to initialize cluster", e)
              throw e;
            }
            this.logger.warn("Failed to initialize cluster. Resource-node runs in non-redundant mode", e);
            //IGNORE
            this.initialConnection = this.toConnObject(uuidv4(), initConn)
            this.isInitialized = true;
            this.isNonRedundantMode = true;
          })
      }))
  }

  finalize() {
    return Promise.resolve()
      .then(()=>this.lock.acquire(this.lockKey, ()=>{
        if (!this.isInitialized) {
          return Promise.resolve();
        }
        return Promise.resolve()
          .then(()=>this._finalize())
          .then(()=>this.isInitialized = false)
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
        this.logger.error("Failed to acquire lock", e)
        return new Promise((res, rej)=>{
          setTimeout(()=>this.acquireLock(key).then(res).catch(rej), ACQUIRE_LOCK_RETRY_INTERVAL);
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
        return new Promise((res, rej)=>{
          setTimeout(()=>this.abandonLock(key).then(res).catch(rej), ACQUIRE_LOCK_RETRY_INTERVAL);
        })
      })
  }

  _initialize(initConn) {
    throw new Error("not implemented")
  }

  _finalize() {
    throw new Error("not implemented")
  }

  _acquireLock(key) {
    throw new Error("not implemented")
  }

  _abandonLock(key) {
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
          targets = target.reverse();
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

  getInitConnection() {
    return this.initialConnection.conn;
  }

}

export default Cluster;