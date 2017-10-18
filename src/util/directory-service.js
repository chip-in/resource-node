import Logger from './logger'
import url from 'url';

export default class DirectoryService {
  
  constructor() {
    this.root = {};
    this.logger = new Logger("DirectoryService");
  }

  lookup(path) {
    if (path == null) {
      return null;
    }
    if (path === "/") {
      //forbidden
      return this.root.value;
    }
    var ctx = this.root;
    var candle = ctx.value;
    var names = path.substring(1).split("/");
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === "" ) {
        continue;
      }
      var nextCtx = ctx.children && ctx.children[name];
      if (!nextCtx) {
        break;
      }
      candle = nextCtx.value || candle;
      ctx = nextCtx;
    }
    return candle;
  }

  bind(path, object) {
    var normalizedPath = url.parse(path).path;
    if (normalizedPath === "/") {
      //root
      this.root.value = object;
      this.logger.debug("bind object(" + path + ")");
      return;
    }
    var names = normalizedPath.substring(1).split("/");
    var dst = this.root;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name === "") {
        continue;
      }
      dst.children = dst.children || {};
      var next = dst.children[name] = dst.children[name] || {};
      next.name = name;
      dst = next;
    }
    if (dst.value != null) {
      this.logger.debug("rebind(" + path + ")");
    }
    dst.value = object;
    this.logger.debug("bind object(" + path + ")");
  } 

  unbind(path) {
    var names = path.substring(1).split("/");
    var target = this.root;
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (name == "") {
        continue;
      }
      if (target.children == null) {
        target = null;
        break;
      }
      target = target.children[name];
      if (!target) {
        break;
      }
    }
    if (!target) {
      this.logger.warn("path is not registered. something go wrong....");
    } else {
      delete target.value;
      this.logger.debug("unbind object(" + path + ")");
    }
  }
}