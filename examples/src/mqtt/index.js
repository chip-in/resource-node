import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

process.on('unhandledRejection', console.dir);

var coreNodeUrl = "http://test-core.chip-in.net:8080";

class RestConnector extends ServiceEngine { }
class DatabaseRegistry extends ServiceEngine { }
class ContextManager extends ServiceEngine { }
class UpdateManager extends ServiceEngine { }
class SubsetStorage extends ServiceEngine { }
class SubscriberImpl extends Subscriber {
  onReceive(msg) {
    rnode.logger.info("Receive MQTT message:", msg.toString());
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
    /* ##### fetch ##### */
    return Promise.resolve()
      .then(() => {
        var topicName = "test_subscriber";
        return rnode.subscribe(topicName, new SubscriberImpl())
          .then(() => rnode.publish(topicName, JSON.stringify({
            "message": "this message will be delivered"
          }))
          )
      })
      .then(() => new Promise((resolve, reject) => {
        setTimeout(resolve, 1000);
      }))
      .then(() => {
        var topicName = "test_subscriber";
        return rnode.unsubscribe(topicName)
          .then(() => rnode.publish(topicName, JSON.stringify({
            "message": "this message will not be delivered"
          }))
          )
      })
      .then(() => rnode.stop())

    //rnode.stop();
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })
