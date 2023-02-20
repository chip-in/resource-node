import AsyncLock from 'async-lock'
import Logger from './logger';
import uuidv4 from 'uuid/v4';
const doLockLogging = (String(process.env.RNODE_ENABLE_LOCK_LOGGING).toUpperCase() === "TRUE") || false 
const lockLogger = new Logger("lock")
const preprocess = (instanceID, funcName, argumentsList) => {
    if (doLockLogging) lockLogger.info(`lock:${instanceID}:${funcName}:prep:${argumentsList && argumentsList[0]}`)
}

const postprocess = (instanceID, funcName, argumentsList) => {
    if (doLockLogging) lockLogger.info(`lock:${instanceID}:${funcName}:post:${argumentsList && argumentsList[0]}`)
}

const createLock = () => {
  const lock = new AsyncLock()
  const instanceID = uuidv4()
  return new Proxy(lock, {
    get(target, prop) {
      if (typeof target[prop] === 'function' && prop === 'acquire') {
        return new Proxy(target[prop], {
          apply: (target, thisArg, argumentsList) => {
            preprocess(instanceID, prop, argumentsList);
            let ret = Reflect.apply(target, thisArg, argumentsList);
            if (typeof ret.then === "function") {
              ret = ret.then((r) => {
                postprocess(instanceID, prop, argumentsList)
                return r
              }).catch(e=> {
                postprocess(instanceID, prop, argumentsList)
                throw e
              })
            }
            return ret
          }
        });
      } else {
        return Reflect.get(target, prop);
      }
    }
  })
}
export {
  createLock
}