import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

process.on('unhandledRejection', console.dir);

var coreNodeUrl = "http://test-core.chip-in.net:8080";

var mode = process.argv[2] || "singletonMaster";

class RestConnector extends ServiceEngine { }
class DatabaseRegistry extends ServiceEngine { }
class ContextManager extends ServiceEngine { }
class UpdateManager extends ServiceEngine { }
class SubsetStorage extends ServiceEngine { }
class ProxyImpl extends Proxy {
  onReceive(req, res) {
    return Promise.resolve()
      .then(() => {
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
  .then(() => {
    rnode.logger.info("Succeeded to start resource-node");

    return Promise.resolve()
/* GET by path*/
      .then(() => rnode.fetch("/c/rn/db-server.yml"))
      .then((resp) => {
        rnode.logger.info("resp.status:" + resp.status + "(expected:" + 200 + ")");
      })
/* GET by URL */
      .then(() => rnode.fetch(coreNodeUrl + "/c/rn/db-server.yml"))
      .then((resp) => {
        rnode.logger.info("resp.status:" + resp.status + "(expected:" + 200 + ")");
      })
/* 404 */
      .then(() => rnode.fetch(coreNodeUrl + "/c/rn/unknown.yml"))
      .then((resp) => {
        rnode.logger.info("resp.status:" + resp.status + "(expected:" + 404 + ")");
      })
/* HEAD  */
      .then(() => rnode.fetch(coreNodeUrl + "/c/rn/db-server.yml", { method: "HEAD" }))
      .then((resp) => {
        rnode.logger.info("resp.status:" + resp.status + "(expected:" + 200 + ")"); 
      })
/* HEADERS */
      .then(() => {
        return rnode.fetch(coreNodeUrl + "/c/rn/db-server.yml", { headers: { "User-Agent": "test" } })
      })
      .then((resp) => {
        rnode.logger.info("resp.status:" + resp.status + "(expected:" + 200 + ")"); 
      })
/* NETWORK ERROR */      
      .then(() => {
        return rnode.fetch("http://localhost:8081")
          .catch((e) => {
            rnode.logger.info("error:" + e);
          })
          .then(() => rnode.fetch())
          .catch((e) => {
            rnode.logger.info("error:" + e);
          })
      })
      .then(()=> rnode.stop())
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
