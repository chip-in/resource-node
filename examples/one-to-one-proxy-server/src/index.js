import webClient from 'request';
import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';
import http from 'http';

process.on('unhandledRejection', console.dir);

console.log(process.argv.length);
if (process.argv.length !== 4) {
  console.log("Usage: npm start -- " +
              "<core_node_url(e.g. 'http://test-core.chip-in.net')> "+
              "<node_class(e.g. 'one-to-one-proxy-server-example')> ")
  process.exit(0);
}
var coreNodeUrl = process.argv[2];
var nodeClass =  process.argv[3];

class SignalHandler {
  constructor(node) {
    this.targets = ["SIGINT", "SIGTERM"];
    this.node = node;
    this._init();
  }
  _init() {
    this.targets.map((s)=>process.on(s, ()=>{
      this.node.logger.info("Shutdown process start.");
      this._execShutdown();
    }));
  }
  _execShutdown() {
    this.node.stop()
    .then(()=>{
      this.node.logger.info("Shutdown process has completed.");
      setImmediate(function() {
				process.exit(0);
			});
    })
  }
}
class OneToOneProxyServer extends ServiceEngine{
  constructor(option) {
    super(option);
    this.path = option.path;
    this.mode = option.mode;
    this.forwardPath = option.forwardPath;
  }
  
  start(node) {
    return Promise.resolve()
      .then(()=>node.mount(this.path, this.mode, new ReverseProxy(node, this.path, this.forwardPath)))
      .then((ret)=>this.mountId = ret)
      .then(()=>node.logger.info("One-To-One-proxy-server started. Try to access '" + coreNodeUrl + this.path + "'"))
  }

  stop(node) {
    return Promise.resolve()
  }

}

class ReverseProxy extends Proxy {
  constructor(rnode, path, forwardPath) {
    super();
    this.rnode = rnode;
    if (path == null) {
      throw new Error("Path is empty")
    }
    this.basePath = path[path.length - 1] !== "/" ? path + "/" : path;
    this.forwardPath = forwardPath;
  }
  onReceive(req, res) {
    return Promise.resolve()
      .then(() => {
        if (req.url.indexOf(this.basePath) !== 0) {
          this.rnode.logger.error("Unexpected path is detected:" + req.url);
          return Promise.reject(new Error("Unexpected path is detected:" + req.url));
        }
        return new Promise((resolve, reject)=>{
          var url = this.forwardPath + String(req.url).substr(this.basePath.length);
          var cb = (e, r, b)=> {
            if (e) {
              this.rnode.logger.error("Failed to proxy backend", e);
              reject(e);
              return;
            }
            //copy properties
            console.log([new Date().toISOString(), req.ip, req.method, req.url, "=>", url, r.statusCode].join(" "))
            var targetProps = ["headers", "statusCode" ];
            targetProps.forEach((p)=>res[p] = r[p]);
            res.end(b);
            resolve(res);
          };

          var option = {
            url,
            headers: Object.assign({}, req.headers),
            encoding: null,
            method : req.method || "GET"
          };
          //request module prefer req.headers.host 
          if (option.headers) delete option.headers.host
          this._convertBody(option,  req.body);
          webClient(option, cb);
        });
      })
  }
  _convertBody(option, body) {
    if (body == null) {
      return ;
    }
    if (typeof body === "object" && Object.keys(body).length === 0) {
      return ;
    }
    //support only json format
    if (body instanceof Buffer || typeof body === "string") {
      option.body = body;
    } else {
      option.body = JSON.stringify(body);
    }
    if (option.headers) {
      delete option.headers["content-length"];
    }
  }
}
var rnode = new ResourceNode(coreNodeUrl, nodeClass);
rnode.registerServiceClasses({
  OneToOneProxyServer
});
rnode.start()
  .then(() => {
    new SignalHandler(rnode);
    rnode.logger.info("Succeeded to start resource-node");
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
