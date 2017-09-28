import EventEmitter from 'events'

export default class WSRequest {
  constructor(msg, res, rej) {
    var names = ["baseUrl","body","cookies","fresh","hostname","ip","method",
      "originalUrl","params","path","protocol","query","secure",
    "signedCookies","headers","httpVersion","rawHeaders","url"];
    names.map((n)=>{
      if(msg && msg.m && msg.m.req) this[n] = msg.m.req[n]
    });
    this.aborted = false;
    this.em = new EventEmitter();
    this.em.on("close", ()=>{
      if (this.timeoutId) {
        clearTimeout(timeoutId);
      }
    });
  }

  on() {
    this.em.on.apply(this.em, Array.prototype.slice.call(arguments));
  }
  emit() {
    this.em.emit.apply(this.em, Array.prototype.slice.call(arguments));
  }
  destroy(e) {
    this.aborted = true;
    this.em.emit("error", e);
  }
  setTimeout(ms, cb) {
    this.timeoutId = setTimeout(()=>{
      this.destroy(new Error("WSRequest:request timeout"));
      cb();
    },ms);
  }

}