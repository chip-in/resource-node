import { ResourceNode, ServiceEngine, Proxy, Subscriber } from '../../..';

process.on('unhandledRejection', console.dir);

if (process.argv.length < 3) {
  console.log("Usage: npm start -- " +
              "<core_node_url(e.g. 'http://test-core.chip-in.net')> "+
              "[<node_class>] ")
  process.exit(0);
}
var coreNodeUrl = process.argv[2];
var nodeClass =  process.argv[3] || "config-example-root";

var jwtToken = process.env.ACCESS_TOKEN;
var jwtRefreshPath = process.env.TOKEN_UPDATE_PATH;

const assert = (expect, value, message) => {
  if (typeof value === "object") {
    value = JSON.stringify(value)
  }
  var result = expect === value
  var msg = `ASSERT##### ${message} => ${result} ${result?`(expect:${expect})`:`(expect:${expect}, result:${value})`}`
  console.log(msg)
  if (!result) { 
    throw new Error(msg)
  }
}

const commonObj = {
  prop1: "foo",
  prop2: "bar",
  prop3: {
    propX: "foobar"
  }
}

class ConfigTest1 extends ServiceEngine {
  constructor(rnconfig) {
    super(rnconfig)
    assert("config-test-1", rnconfig.name, "check rnconfig.name")
    assert(JSON.stringify(commonObj), rnconfig.option, "check rnconfig.option")
    this.result = true
  }
  getResult() {
    return this.result
  }
}

class ConfigTest2 extends ServiceEngine {
  constructor(rnconfig) {
    super(rnconfig)
    assert("config-test-2", rnconfig.name, "check rnconfig.name")
    rnconfig.option.list.map(child=> {
      assert(JSON.stringify(commonObj), child.option, "check rnconfig.option.list.option")
    })
    this.result = true
  }
  getResult() {
    return this.result
  }
}

var rnode = new ResourceNode(coreNodeUrl, nodeClass);
if (jwtToken) {
  rnode.setJWTAuthorization(jwtToken, jwtRefreshPath);
}
rnode.registerServiceClasses({
  ConfigTest1,
  ConfigTest2,
});
try{
rnode.start()
  .then(() => {
    rnode.logger.info("Succeeded to start resource-node");
    var names = ["ConfigTest1", "ConfigTest2"]
    names.map(name => {
      const seList = rnode.searchServiceEngine(name)
      if (seList.length != 1) {
        throw new Error("SE count must be 1. " + name + ":" + seList.length)
      }
      assert(true, seList[0].getResult(), "check config is loaded")
    })
    rnode.stop()
  }).catch((e) => {
    console.error("Failed to processing", e)
    try {
      rnode.stop()
    } catch(e2){}
  })
} catch(e) {
  console.error("Failed to processing", e)
  try {
    rnode.stop()
  } catch(e2){}
}