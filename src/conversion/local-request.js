import WSRequest from './ws-request';
import url from 'url';
import cookieParser from 'cookie-parser';

export default class LocalRequest extends WSRequest{

    constructor(requestHref, option) {
      super({});
      option = option || {};
      var urlObj = url.parse(requestHref);
      this.baseUrl = "";
      this.url = urlObj.href;
      this.method = option.method || "GET";
      this.body = option.body;
      this.headers = this._convertHeaders(option.headers);
      this.cookies = this._parseCookies(this.headers["Cookie"]); 
    }
    _parseCookies(cookie) {
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
    _convertHeaders(headers) {
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
}