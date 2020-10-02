import AbstractConnection from './abstract-connection';
import mqtt from 'mqtt';
import {Qlobber} from 'qlobber';
import url from 'url';
import uuidv4 from 'uuid/v4';

const port = process.env.CNODE_MQTT_PORT ? (":" + process.env.CNODE_MQTT_PORT) : '';
const mqttPath = process.env.CNODE_MQTT_PATH || "/m";
const SUBSCRIBE_QOS = 1

class MQTTConnection extends AbstractConnection {

  constructor(coreNodeURL, basePath, userId, password, token) {
    super(coreNodeURL, basePath, userId, password, token);
    this.mqttclient = null;
    this.subscribers = [];
    this.waiters = []
  }

  _open() {
    if (this.mqttclient != null) {
      return new Promise((resolve, reject) => {
        this.waiters.push(resolve)
      })
    }
    return Promise.resolve()
    .then(()=>{
      var mqttUrl = this._createMQTTUrl();
      var mqttConnectOption = this._createMQTTConnectOption();
      return new Promise((resolve, reject)=>{
        var isInit = true;
        this.mqttclient = mqtt.connect(mqttUrl, mqttConnectOption);
        this.mqttclient.on("connect", ()=>{
          this.logger.info("mqtt connection connected");
          this.isConnected = true;
          if (isInit) {
            resolve();
            isInit = false;
          }
          if (this.waiters.length > 0) {
            this.waiters.map((waiter) => waiter())
            this.waiters = []
          }
        }); 
        this.mqttclient.on("reconnect", ()=>{
          this.logger.info("mqtt connection reconnecting...");
        }); 
        var onClose = (e)=>{
          this.logger.warn("mqtt connection closed", e ? e : "");
          this.isConnected = false;
        }
        this.mqttclient.on("message", (topic, message, packet)=>{
          const isRetain = packet.retain;
          this.subscribers.map((entry)=>{
            if (entry.matcher.match(topic).length > 0 &&
                (!isRetain || !entry.retainReceived)) {
              entry.subscriber.onReceive(message);
              entry.retainReceived = true;
            }
          })
        })
        this.mqttclient.on("close", onClose)
        this.mqttclient.on("disconnect", onClose)
        this.mqttclient.on("error", (e) => {
          this.logger.error("mqtt error detected", e);
          if (isInit) {
            reject(e);
            isInit = false;
          }
        })
      })
    })
  }
  _close() {
    return Promise.resolve()
    .then(()=>this.mqttclient != null ? this.mqttclient.end() : Promise.resolve())
  }

  publish(topicName, message) {
    return Promise.resolve()
    .then(()=>this.ensureConnected())
    .then(()=>new Promise((resolve, reject)=>{
      this.mqttclient.publish(topicName, message, {qos: 1, retain: true}, (e)=>{
        if (e) {
          this.logger.error("Failed to publish(%s)", topicName, e);
          reject(e);
          return;
        }
        this.logger.info("Succeeded to publish(%s)", topicName)
        resolve();
      })
    }))
  }
  
  _createMatcher(topicName) {
    var ret = new Qlobber({ separator: "/", wildcard_one: "+" });
    ret.add(topicName, true)
    return ret;
  }

  subscribe(topicName, subscriber) {
    var key = uuidv4();
    return Promise.resolve()
    .then(()=>this.ensureConnected())
    .then(()=>{
      var responded = false;
      return new Promise((res, rej)=>{
        this.logger.info("bind mqtt topic and key(%s : %s)", topicName, key);
        this.subscribers.push({
          subscriber, key, topicName, 
          matcher : this._createMatcher(topicName),
        })
        var topicObj = {resubscribe:true};
        topicObj[topicName] = SUBSCRIBE_QOS
        this.mqttclient.subscribe(topicObj, {}, (e, g)=>{
          this.logger.info("subcribe topic(%s):error=%s:granted=%s", topicName, e, JSON.stringify(g))
          if (!responded) {
            responded = true;
            res(key);
          }
        })
      })
    })
  }
  
  _unsubscribe(targets, ignoreError) {
    return targets.reduce((p, entry)=>{
      return p.then(()=>new Promise((res, rej)=>{
        this.mqttclient.unsubscribe(entry.topicName, (e)=>{
          if (e) {
            this.logger.warn("Failed to unsubscribe topic:(%s : %s)", entry.topicName, entry.key, e);
            if (ignoreError) {
              res();
            }
            rej(e);
            return;
          }
          this.logger.info("Succeeded to unsubscribe topic(%s : %s)", entry.topicName, entry.key);
          res();
        })
      }))
    }, Promise.resolve())
  }

  unsubscribe(key) { 
    var targets = this.subscribers.filter((e)=>e.key === key);
    if (targets.length === 0) {
      this.logger.warn("Key not found:%s", key);
      return Promise.resolve();
    }
    //allow duplicated topicName
    var effectiveSubscribers = this.subscribers.filter((e) => e.key !== key);
    var effectiveTopicNames = effectiveSubscribers.reduce((dst,v)=>{
      dst[v.topicName] = true;
      return dst;
    },{})
    const ineffectiveTopicEntries = targets.filter((e)=>effectiveTopicNames[e.topicName] == null)
    this.logger.info("Succeeded to remove subscriber key(key=%s, target=%s, mqttInvocationTarget=%s). ", 
      key, JSON.stringify(targets.map((e)=>e.topicName)), JSON.stringify(ineffectiveTopicEntries.map((e)=>e.topicName)));
    this.subscribers = effectiveSubscribers
    return Promise.resolve()
      .then(()=>this._unsubscribe(ineffectiveTopicEntries))
  }

  unsubscribeAll() {
    var targets = this.subscribers;
    return Promise.resolve()
      .then(()=>this._unsubscribe(targets, true))
      .then(()=>this.subscribers = [])
  }


  _createMQTTUrl() {
    var mqttProto = process.env.CNODE_MQTT_PROTO || 
      ((this.coreNodeURL.indexOf("https://") === 0) ? 'wss' : 'ws');
    var coreUrl = url.parse(this.coreNodeURL);
    var coreHost = coreUrl.host;

    return [mqttProto,"://",coreHost,port,this.basePath,mqttPath].join("");
  }
  
  _createMQTTConnectOption() {
    var ret = {
      keepalive: 30,
      wsOptions : {
        headers : this.createAuthorizationHeaders(this.userId, this.password, this.token)
      }
    };

    if (this.token == null) {
      return ret;
    }
    ret.username = this.token;
    return ret;
    
  }
}
export default MQTTConnection