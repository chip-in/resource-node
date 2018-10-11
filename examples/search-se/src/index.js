import {ResourceNode, ServiceEngine, Proxy, Subscriber} from '../../..';

process.on('unhandledRejection', console.dir);

if (process.argv.length < 3) {
  console.log("Usage: npm start -- " +
              "<core_node_url(e.g. 'http://test-core.chip-in.net')> "+
              "[<node_class>] ")
  process.exit(0);
}
var coreNodeUrl = process.argv[2];
var nodeClass =  process.argv[3] || "db-server";

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
      res.send(JSON.stringify(req));
      return res;
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
    
    /* by name (found) */
    var result1 = rnode.searchServiceEngine("DatabaseRegistry");
    rnode.logger.info("searchServiceEngine1(match by name):" + (1 ===result1.length));
    /* by name (not found) */
    var result2 = rnode.searchServiceEngine("Unknown");
    rnode.logger.info("searchServiceEngine2(match by name):" + (0 ===result2.length));
    /* by name + filter (found) */
    var result3 = rnode.searchServiceEngine("DatabaseRegistry", {database:"alerts"});
    rnode.logger.info("searchServiceEngine3(match by name+filter):" + (1 ===result3.length));
    /* by name + filter (not found)  */
    var result4 = rnode.searchServiceEngine("DatabaseRegistry", {database:"unknown"});
    rnode.logger.info("searchServiceEngine4(match by name+filter):" + (0 ===result4.length));

    return Promise.resolve()
    .then(()=> rnode.stop())
  }).catch((e)=>{
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
