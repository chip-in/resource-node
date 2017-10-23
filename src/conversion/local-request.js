import WSRequest from './ws-request';
import url from 'url';
import cookieParser from 'cookie-parser';

var _parseCookies = (cookie) => {
  var ret = {};
  if (cookie == null) {
    return ret;
  }
  var parsed = cookieParser.JSONCookie(cookie);
  if (typeof parsed !== "object") {
    //failed to parse coookie
    return ret;
  }
  return parsed;
}
var _convertHeaders= (headers)=> {
  var ret = {};
  if (headers == null) {
    return ret;
  }
  if (typeof headers !== "object") {
    return ret;
  }
  if (typeof headers.forEach === "function") {
    headers.forEach((v,n)=>ret[n] = v);
  } else {
    ret = Object.assign(headers, ret);
  }
  return ret;
}

export default class LocalRequest extends WSRequest{

    constructor(requestHref, option) {
      super({
        "m" : {
          "req" : {
            body : option && option.body,
            method : option && option.method || "GET",
            url : url.parse(requestHref).href,
            baseUrl : "",
            headers : option && _convertHeaders(option.headers),
            cookies : option && _parseCookies(option.headers["cookie"])
          }
        }
      })
    }
}