import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

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

class RestConnector extends ServiceEngine { }
class DatabaseRegistry extends ServiceEngine { }
class ContextManager extends ServiceEngine { }
class UpdateManager extends ServiceEngine { }
class SubsetStorage extends ServiceEngine { }
class QueryHandler extends ServiceEngine { }
class SubscriberImpl extends Subscriber {
  onReceive(msg) {
    rnode.logger.info("Receive MQTT message:", msg.toString());
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
  .then(() => {
    rnode.logger.info("Succeeded to start resource-node");
    var topicName = "test_subscriber";
    var subscriberId = null;
    return Promise.resolve()
      .then(() => {
        return rnode.subscribe(topicName, new SubscriberImpl())
          .then((key) => {
            subscriberId = key;
            return rnode.publish(topicName, JSON.stringify({
              "message": "this message will be delivered"
            }))
          })
      })
      .then(() => new Promise((resolve, reject) => {
        setTimeout(resolve, 1000);
      }))
      .then(() => {
        return rnode.unsubscribe(subscriberId)
          .then(() => rnode.publish(topicName, JSON.stringify({
            "message": "this message will not be delivered"
          }))
          )
      })
      .then(() => {
        var topicName = "test_multiple_subscriber";
        var subscribers = [new SubscriberImpl(), new SubscriberImpl()];
        return Promise.resolve()
          .then(()=>Promise.all(subscribers.map((s)=>rnode.subscribe(topicName, s))))
          .then(() => rnode.publish(topicName, JSON.stringify({
            "message": "this message will be delivered for 2 subscribers"
          })))
      })
      .then(() => rnode.stop())

    //rnode.stop();
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
