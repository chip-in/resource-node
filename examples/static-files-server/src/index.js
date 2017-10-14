import StaticFileServer from './server';
import webClient from 'request';
import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

process.on('unhandledRejection', console.dir);

//var coreNodeUrl = "http://test-core.chip-in.net:8080";
var coreNodeUrl = "http://test-core.chip-in.net:8080";
var path = "/a/static-files-server/"
var mode = "singletonMaster";

class RestConnector extends ServiceEngine { }
class DatabaseRegistry extends ServiceEngine { }
class ContextManager extends ServiceEngine { }
class UpdateManager extends ServiceEngine { }
class SubsetStorage extends ServiceEngine { }
class ReverseProxy extends Proxy {
  constructor(rnode, path, server) {
    super();
    this.rnode = rnode;
    if (path == null) {
      throw new Error("Path is empty")
    }
    this.basePath = path[path.length - 1] !== "/" ? path + "/" : path;
    this.be = server;
  }
  onReceive(req, res) {
    return Promise.resolve()
      .then(() => {
        var method = req.method || "GET";
        if (method !== "GET" && method !== "POST") {
          this.rnode.logger.error("This sample support only GET|POST method.");
          return Promise.reject(new Error("This sample support only GET|POST method."));
        }
        if (path.indexOf(this.basePath) !== 0) {
          this.rnode.logger.error("Unexpected path is detected:" + path);
          return Promise.reject(new Error("Unexpected path is detected:" + path));
        }
        return new Promise((resolve, reject)=>{
          var cb = (e, r, b)=> {
            if (e) {
              this.rnode.logger.error("Failed to proxy backend", e);
              reject(e);
              return;
            }
            //copy properties
            var targetProps = ["headers", "statusCode" ];
            targetProps.forEach((p)=>res[p] = r[p]);
            res.end(b);
            resolve(res);
          };

          var url = "http://localhost:" + this.be.getPort() + String(req.url).substr(this.basePath.length-1);
          var option = {
            url,
            headers: req.headers,
            encoding: null
          };
          this._convertBody(option,  req.body);
          if (method === "GET") {
            webClient.get(option, cb);
          } else {
            webClient.post(option, cb);
          }
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
    if (body instanceof Buffer || typeof body === "string") {
      option.body = body;
    } else {
      option.body = JSON.stringify(body);
    }

  }
}
var rnode = new ResourceNode(coreNodeUrl, "db-server");
rnode.registerServiceClasses({
  RestConnector,
  DatabaseRegistry,
  ContextManager,
  UpdateManager,
  SubsetStorage
});
var mountId = null;
rnode.start()
  .then(() => {
    rnode.logger.info("Succeeded to start resource-node");
    var server = new StaticFileServer();
    return Promise.resolve()
      .then(()=>server.start())
      .then(()=>rnode.mount(path, mode, new ReverseProxy(rnode, path, server))) 
      .then((ret) => {
        mountId = ret;
      })
      .then(()=>{
        rnode.logger.info("Static-files-server started. Try to access '" + coreNodeUrl + path + "'");
      })
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
