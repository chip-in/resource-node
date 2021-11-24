import Logger from './logger';
import nunjucks from 'nunjucks';
import YAML  from 'yamljs';

var basePath = "/c/rn/";
var ext = "yml";

var doIndent = (val, indent)=> {
  if (val == null) {
    return val;
  }
  var tabs = ""
  for(var i = 0; i < indent; i++) {
    tabs += " "
  }
  var vals = val.split("\n");
  var dst = [];
  for (var i = 0; i < vals.length; i++) {
    if (i !== 0) {
      dst.push(tabs + vals[i]);
    } else {
      //1st row is not needed to indent
      dst.push(vals[i]);
    }
  }
  return dst.join("\n");
}

class CIConfigParser {
  constructor(rnode) {
    this.rnode = rnode;
  }
  
  parse(parser, nodes, lexer) {
    var tok = parser.nextToken();
    var args = parser.parseSignature(null, true);
    parser.advanceAfterBlockEnd(tok.value);
    return new nodes.CallExtensionAsync(this, 'run', args);
  }
}

class CINodeConfigParser extends CIConfigParser{
  constructor(rnode){
    super(rnode);
    this.tags = ["ciNodeConfig"]
  }

  run(context, args, callback) {
    new ConfigLoader(this.rnode)
      ._loadYaml(args.ref)
      .then((ret)=>callback(null, doIndent(ret, parseInt(args.indent || 0))))
      .catch((e)=>callback(e))
  }
}

export default class ConfigLoader {

  constructor(rnode) {
    this.rnode = rnode;
    this.logger = new Logger("ConfigLoader");
  }

  load(nodeClassName) {
    return this._load(basePath + nodeClassName + "." + ext);
  }

  _load(path) {
    return this._loadYaml(path)
    .then((yml)=>{
      return YAML.parse(yml);
    })
  }

  _loadYaml(path) {
    this.logger.debug("load config from %s", path);
    return Promise.resolve()
      .then(()=>this.rnode.fetch(path))
      .then((resp)=>{
        if (resp.status !== 200) {
          this.logger.warn("Failed to search nodeclass. sc:%s", resp.status);
          throw new Error("Failed to search nodeclass");
        }
        return resp.text();
      })
      .then((yml)=>{
        return Promise.resolve()
          .then(()=>{
            return new Promise((resolve, reject)=>{
              this.logger.debug("Transform YAML file(%s) %s", path, yml)
              var tmpl = new nunjucks.Template(yml, this._createEnvironment(), path);
              var ctx = {};
              tmpl.render(ctx, (err, res)=>{
                if (err) {
                  this.logger.error("Failed to transformed YAML file(%s)", path, err);
                  reject(err);
                  return;
                }
                this.logger.debug("Succeeded to transform YAML file(%s) : %s", path, res);
                resolve(res);
              })
            })
          })
      })
  }
  _createEnvironment() {
    var env = new nunjucks.Environment();
    env.opts.autoescape = false;
    env.addExtension('CINodeConfig', new CINodeConfigParser(this.rnode));
    env.addGlobal("ciContext", this.rnode.getContext());
    env.addGlobal("JSON", JSON);
    env.addGlobal("YAML", YAML);
    return env;
  }
}
