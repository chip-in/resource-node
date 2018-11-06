import './assets/css/sample.css';
import mylogo from './assets/img/logo.png';
import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

class EchoBack extends Proxy {
  onReceive(req, res) {
    return Promise.resolve()
      .then(() => {
        return new Promise((resolve, reject)=>{
          var postData = "";
          req.on("data", (chunk)=>{
            postData += chunk;
          });
          req.on("end", ()=>{
            writeMountResult("received request(" + [req.ip, req.method, req.url, postData].join(" ") + ")");
            res.writeHead(200, {
              "Content-Type": "application/json"
              , "Access-Control-Allow-Origin": "*"
            });
            res.write(JSON.stringify(req));
            res.end();
            resolve(res);
          })
        })
        
        
      })
  }
}
class SubscriberImpl extends Subscriber {
  onReceive(msg) {
    writePubSubResult("Receive MQTT message:" + msg.toString());
  }
}
var initLogo = () =>{
  var logo = new Image();
  logo.src = mylogo;
  document.getElementById("brand-container").appendChild(logo);
}

var writeResult = (dstId, value) => {
  var now = new Date().toISOString();
  var dst = document.getElementById(dstId);
  if (dst != null) {
    dst.innerHTML = "[" + now + "]" + value + "<br/>" + dst.innerHTML;
  }
}
var writeMountResult = (value) => {
  writeResult("example-mount-result", value)
}
var writePubSubResult = (value, append) => {
  writeResult("example-pubsub-result", value)
}
var writeContextResult = (value, append) => {
  writeResult("example-context-result", value)
}
var node = null;
var mountIdMap = {};
var subscriptionMap = {};

var execMount = function() {
  var op = document.getElementById("example-mount-operation").value;
  var param = document.getElementById("example-mount-param").value;
  if (op == null || op === "" || param == null || param === "") {
    writeMountResult("operation or parameter is not specified");
    return false;
  }
  if (node == null) {
    writeMountResult("node is not initialized");
    return false;
  }
  node.setBasicAuthorization("username", "password")
  var promise = null;
  if (op === "mount") {
    var param2 = document.getElementById("example-mount-param2").value;
    promise = node.mount(param, param2, new EchoBack())
    .then((mountId)=>{
      mountIdMap[param] = mountIdMap[param] || [];
      mountIdMap[param].push(mountId);
      writeMountResult("Succeeded to mount path:" + param + "," + param2);
    })
    .catch((e)=>{
      writeMountResult("Failed to mount :" + e.message);
    })
  } else if (op === "unmount") {
    var target = mountIdMap[param];
    if (target == null || target.length === 0) {
     writeMountResult("specified path is not mounted at this session");
     return false;
    }
    promise = Promise.all(mountIdMap[param].map((id)=>{
      return node.unmount(id);
    }))
    delete mountIdMap[param];
  } else if (op === "fetch_get") {
    promise = node.fetch(param)
  } else if (op === "fetch_post") {
    promise = node.fetch(param, {
      "method" : "POST",
      "body" : JSON.stringify({
        "param1" : "value1",
        "param2" : 2
      }),
      headers : {
        "Content-Type": "application/json"
      }
    })
  } else {
    writeMountResult("unexpected method name :" + op);
    return false;
  }
  promise.then(()=>{
    writeMountResult("Succeeded to process(" + op + "," + param +")");
  })
  .catch((e)=>{
    writeMountResult("Failed to execute:" + e.stack);
  })
}
var execPubSub = () =>{
  var op = document.getElementById("example-pubsub-operation").value;
  var param = document.getElementById("example-pubsub-param").value;
  if (op == null || op === "" || param == null || param === "") {
    writePubSubResult("operation or parameter is not specified");
    return false;
  }
  if (node == null) {
    writePubSubResult("node is not initialized");
    return false;
  }
  var promise = null;
  if (op === "subscribe") { 
    promise = node.subscribe(param, new SubscriberImpl())
    .then((subscription)=>{
      subscriptionMap[param] = subscriptionMap[param] || [];
      subscriptionMap[param].push(subscription);
    })
  } else if (op === "unsubscribe") {
    var target = subscriptionMap[param];
    if (target == null || target.length === 0) {
      writePubSubResult("specified topic is not subscribed at this session");
     return false;
    }
    promise = Promise.all(subscriptionMap[param].map((id)=>{
      return node.unsubscribe(id);
    }))
  } else if (op === "publish") {
    promise = node.publish(param, "'sample message published at " + new Date().toISOString() + "'")
  } else {
    writePubSubResult("unexpected method name :" + op);
    return false;
  }
  promise.then(()=>{
    writePubSubResult("Succeeded to process(" + op + "," + param +")");
  })
  .catch((e)=>{
    writePubSubResult("Failed to execute:" + e.stack);
  })
}
var execContext = () =>{
  var op = document.getElementById("example-context-operation").value;
  if (op == null || op === "") {
    writeContextResult("operation is not specified");
    return false;
  }
  if (node == null) {
    writeContextResult("node is not initialized");
    return false;
  }
  var promise = null;
  if (op === "getContext") { 
    var ret = node.getContext();
    writeContextResult("Succeeded to get context:" + JSON.stringify(ret, null, 2));
  } else if (op === "setCustomParameter") {
    var param1 = document.getElementById("example-context-param1").value;
    var param2 = document.getElementById("example-context-param2").value;
    if (param1 == null || param1 === "" || param2 == null || param2 === "") {
      writeContextResult("parameter is not specified");
      return false;
    }
    node.setCustomParameter(param1, param2)
    .then(()=>{
      writeContextResult("Succeeded to set parameter:" + param1 + "," + param2);
    })
  } else {
    writeContextResult("unexpected method name :" + op);
    return false;
  }
}
var startBtn = () =>{
  document.getElementById("example-mount-btn").onclick = execMount;
  document.getElementById("example-pubsub-btn").onclick = execPubSub;
  document.getElementById("example-context-btn").onclick = execContext;
}

process.on('unhandledRejection', console.dir);

var coreNodeUrl = location.protocol + "//" + location.hostname + (location.port != null ? ":"+location.port : "") + "/";

class RestConnector extends ServiceEngine { }
class DatabaseRegistry extends ServiceEngine { }
class ContextManager extends ServiceEngine { }
class UpdateManager extends ServiceEngine { }
class SubsetStorage extends ServiceEngine { }
class QueryHandler extends ServiceEngine { }

var startNode = () =>{
  var rnode = new ResourceNode(coreNodeUrl, "db-server");
  rnode.registerServiceClasses({
    RestConnector,
    DatabaseRegistry,
    ContextManager,
    UpdateManager,
    SubsetStorage,
    QueryHandler
  });
  rnode.start()
    .then(() => {
      rnode.logger.info("Succeeded to start resource-node");
      node = rnode;
    })
}

 window.onload = function() {
   initLogo();
   startBtn();
   startNode();
 }