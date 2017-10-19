import EventEmitter from 'events'
import intoStream from 'into-stream'

export default class WSRequest {
  constructor(msg) {
    var names = ["baseUrl","body","cookies","fresh","hostname","ip","method",
      "originalUrl","params","path","protocol","query","secure",
    "signedCookies","headers","httpVersion","rawHeaders","url"];
    names.map((n)=>{
      if(msg && msg.m && msg.m.req) this[n] = msg.m.req[n]
    });
    this.aborted = false;
    //delegate for stream.Readable interface
    this.stream = intoStream(this.body && Object.keys(this.body).length !== 0 ? JSON.stringify(this.body) : "");
    this.stream.on("close", ()=>{
      if (this.timeoutId) {
        clearTimeout(timeoutId);
      }
    })
  }

  on(evt) {
    //delegate
    this.stream.on.apply(this.stream, Array.prototype.slice.call(arguments));
  }
  emit() {
    this.stream.emit.apply(this.stream, Array.prototype.slice.call(arguments));
  }
  destroy(e) {
    this.aborted = true;
    this.stream.destroy(e);
  }
  setTimeout(ms, cb) {
    this.timeoutId = setTimeout(()=>{
      this.destroy(new Error("WSRequest:request timeout"));
      cb();
    },ms);
  }
  //implementation stream.Readable
  isPaused(){
    return this.stream.isPaused();
  }
  pause() {
    return this.stream.pause();
  }
  pipe(destination, options) {
    return this.stream.pipe(destination, options);
  }
  read(size) {
    return this.stream.read(size);
  }
  resume() {
    return this.stream.resume();
  }
  setEncoding(enc) {
    return this.stream.setEncoding(enc);
  }
  unpipe(destination) {
    return this.stream.unpipe(destination);
  }
  unshift(chunk) {
    return this.stream.ushift(chunk);
  }
  wrap(stream) {
    return this.stream.wrap(stream);
  }
}