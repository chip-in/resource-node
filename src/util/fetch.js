var fetchOption = {};
var isBrowser=new Function("try {return this===window;}catch(e){ return false;}");

var fetchImpl = null;
if (isBrowser()) {
  require('whatwg-fetch');
  fetchImpl = fetch;
  fetchOption.credentials = "same-origin";
} else {
  fetchImpl = require("node-fetch");
}

export {
  fetchImpl,
  fetchOption 
}