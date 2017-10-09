import buffer from 'buffer';

var Buffer = buffer.Buffer;
export default class WSResponse {
  constructor(msg, res, rej, req) {
    this.msg = msg;
    this.res = res;
    this.rej = rej;
    this.req = req;
    this.cookies = []
    if (msg.cookies) {
      for (var k in msg.cookies) {
        msg.cookies.push({
          name: k,
          value: msg.cookies[k]
        });
      }
    }
    this.headers = {};
    this.statusCode = 200;
    this.answered = false;
  }
  append(field, value) {
    this.headers[field] = this.headers[field] || [];
    this.headers[field].push(value);
  }
  cookie(name, value, options) {
    this.cookies.push({
      name: name,
      value: value,
      option: options
    });
  }
  end(data, encoding, cb) {
    this.write(data, encoding, cb);
    Promise.resolve()
      .then(() => this._answer())
      .then(() => {
        if (typeof cb === "function") cb();
      });
  }
  get(field) {
    return headers[field][0];
  }
  location(path) {
    this.location = path;
  }
  redirect(status, path) {
    this.statusCode = status;
    this.location = path;
  }
  send(body) {
    this.body = body;
    this._answer();
  }
  sendStatus(sc) {
    this.statusCode = sc;
    this._answer();
  }
  set(field, value) {
    this.headers[field] = [];
    this.headers[field].push(value);
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  type(t) {
    this.type = t;
  }
  vary(field) {
    this.set("Vary", field);
  }
  getHeader(h) {
    return this.get(h);
  }
  getHeaderNames() {
    return this.headers.keys();
  }
  getHeaders() {
    return this.headers;
  }
  hasHeader(name) {
    return this.headers[name] ? true : false;
  }
  removeHeader(name) {
    delete this.headers[name];
  }
  setHeader(name, value) {
    this.set(name, value);
  }
  setTimeout(ms, cb) {
    this.timeoutId = setTimeout(()=>{
      this.status(503)
      this.end("WSResponse: response timeout");
      if (typeof cb === "function") cb();
    }, ms);
  }
  write(chunk, encoding, cb) {
    if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }
    if (encoding) {
      this.encoding = encoding;
    }
    if (chunk == null) {
      return;
    }
    if (typeof chunk === "string") {
      this.body += chunk;
    } else if (Buffer.isBuffer(chunk)) {
      if (this.body != null) {
        this.body = Buffer.concat(this.body, chunk);
      } else {
        this.body = chunk;
      }
    } else if (chunk != null) {
      //???
      this.body += chunk.toString();
    }
  }
  writeContinue() {
    this.status(101)
    this._answer();
  }
  writeHead(sc, statusMessage, headers) {
    this.status(sc);
    headers.keys().map((k)=>this.append(k, headers[k]));
  }

  _answer() {
    if (this.answered) {
      return Promise.resolve(this);
    }
    return Promise.resolve()
      .then(()=>this.answered = true)
      .then(()=>{
        if (this.timeoutId) {
          clearTimeout(timeoutId);
        }
      }).then(()=>{
        this.req.emit("close");
      }).then(()=>this.res(this));
  }
}