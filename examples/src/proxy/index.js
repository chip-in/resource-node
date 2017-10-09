import {ResourceNode, ServiceEngine, Proxy, Subscriber} from '../../..';

process.on('unhandledRejection', console.dir);

var coreNodeUrl = "http://test-core.chip-in.net:8080";

var mode = process.argv[2] || "singletonMaster";

class RestConnector extends ServiceEngine {}
class DatabaseRegistry extends ServiceEngine {}
class ContextManager extends ServiceEngine {}
class UpdateManager extends ServiceEngine {}
class SubsetStorage extends ServiceEngine {}
class ProxyImpl extends Proxy {
  onReceive(req, res) {
    return Promise.resolve()
    .then(()=>{
      res.send(JSON.stringify(req));
      return res;
    })
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
rnode.start()
  .then(()=>{
    rnode.logger.info("Succeeded to start resource-node");

    /* ##### fetch ##### */
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
              "body" : {
                "param1" : "value1",
                "param2" : 2
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
