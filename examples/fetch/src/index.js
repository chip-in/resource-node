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
          var body = req.headers && req.headers["authorization"] ? req.headers && req.headers["authorization"] : JSON.stringify(req);
          res.write(body);
          res.end();
          resolve(res);
        })
      })
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
/*setBasicAuthorization, POST, localOnly*/
      .then(()=>{
        return rnode.mount("/a/test_fetch_header", "localOnly", new ProxyImpl())
          .then((mountId)=>{
            var username = "username";
            var password = "password";
            var expected = "Basic " + new Buffer(username + ":" + password).toString("base64");
            rnode.setBasicAuthorization(username, password)
            return rnode.fetch("/a/test_fetch_header", {
                "method" : "POST",
                "body" : JSON.stringify({
                  "param1" : "value1",
                  "param2" : 2
                }),
                headers : {
                  "Content-Type": "application/json"
                }
              })
              .then((resp)=>resp.text())
              .then((val)=>rnode.logger.info("resp.body:" + val + "(assertEqual:" + (val === expected) + ")"))
              .then(()=>rnode.unmount(mountId))
          })
      })
      /*setBasicAuthorization, POST, singletonMaster*/
            .then(()=>{
              return rnode.mount("/a/test_fetch_header", "singletonMaster", new ProxyImpl())
                .then((mountId)=>{
                  var username = "username";
                  var password = "password";
                  var expected = "Basic " + new Buffer(username + ":" + password).toString("base64");
                  rnode.setBasicAuthorization(username, password)
                  return rnode.fetch("/a/test_fetch_header", {
                      "method" : "POST",
                      "body" : JSON.stringify({
                        "param1" : "value1",
                        "param2" : 2
                      }),
                      headers : {
                        "Content-Type": "application/json"
                      }
                    })
                    .then((resp)=>resp.text())
                    .then((val)=>rnode.logger.info("resp.body:" + val + "(assertEqual:" + (val === expected) + ")"))
                    .then(()=>rnode.unmount(mountId))
                })
            })
      .then(()=> rnode.stop())
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
