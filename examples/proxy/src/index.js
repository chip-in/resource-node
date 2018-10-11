import {ResourceNode, ServiceEngine, Proxy, Subscriber} from '../../..';

process.on('unhandledRejection', console.dir);

if (process.argv.length < 3) {
  console.log("Usage: npm start -- " +
              "<core_node_url(e.g. 'http://test-core.chip-in.net')> "+
              "[<node_class>] [<mode>] ")
  process.exit(0);
}
var coreNodeUrl = process.argv[2];
var nodeClass =  process.argv[3] || "db-server";

var mode = process.argv[4] || "singletonMaster";

var jwtToken = process.env.ACCESS_TOKEN;
var jwtRefreshPath = process.env.TOKEN_UPDATE_PATH;

class RestConnector extends ServiceEngine {}
class DatabaseRegistry extends ServiceEngine {}
class ContextManager extends ServiceEngine {}
class UpdateManager extends ServiceEngine {}
class SubsetStorage extends ServiceEngine {}
class QueryHandler extends ServiceEngine { }
class ProxyImpl extends Proxy {
  onReceive(req, res) {
    return Promise.resolve()
    .then(()=>{
      return new Promise((resolve, reject)=>{
        var postData = "";
        req.on("data", (chunk)=>{
          postData += chunk;
        });
        req.on("end", ()=>{
          console.log("PostData=>" + postData);
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
var rnode = new ResourceNode(coreNodeUrl, nodeClass);
if (jwtToken) {
  rnode.setJWTAuthorization(jwtToken, jwtRefreshPath);
}
rnode.registerServiceClasses({
  RestConnector,
  DatabaseRegistry,
  ContextManager,
  UpdateManager,
  SubsetStorage,
  QueryHandler
});
rnode.start()
  .then(()=>{
    rnode.logger.info("Succeeded to start resource-node");

    return Promise.resolve()
      .then(()=>{
        var names = [];
        for (var i = 0; i < 10; i++) {
          names.push("path" + i);
        }
        var ids = [];
        return Promise.all(names.map((n)=>{
          var path = "/a/" + mode + n;
          var instance = new ProxyImpl();
          return Promise.resolve()
            .then(()=>rnode.mount(path, mode, instance))
            .then((mountId)=>ids.push(mountId))
            .then(()=>rnode.fetch(path + "/get.txt"))
            .then((resp)=> resp.text())
            .then((val)=>rnode.logger.info("Response body :%s", val))
        }))
        .then(()=>Promise.all(ids.map((n)=>{
          return Promise.resolve()
            .then(()=>rnode.unmount(n))
        })))
        .then(()=>{
          ids = [];
        })
        .then(()=>Promise.all(names.map((n)=>{
          var path = "/a/" + mode + n;
          var instance = new ProxyImpl();
          return Promise.resolve()
            .then(()=>rnode.mount(path, mode, instance))
            .then((mountId)=>ids.push(mountId))
            .then(()=>rnode.fetch(path + "/post.txt", {
              "method" : "POST",
              "body" : JSON.stringify({
                "param1" : "value1",
                "param2" : 2
              }),
              headers : {
                "Content-Type": "application/json"
              }
            }))
            .then((resp)=> resp.text())
            .then((val)=>rnode.logger.info("Response body :%s", val))
        })))
        .then(()=>Promise.all(ids.map((n)=>{
          return Promise.resolve()
            .then(()=>rnode.unmount(n))
        })))
        .then(()=>rnode.stop())
      })

    //rnode.stop();
  }).catch((e)=>{
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
