export default class StaticFileServer {
  constructor(port) {
    this.port = port || 13000;
  }
  start() {
    var express = require('express');
    var logger = require('morgan');
    var path = require('path');
    var app = express();
    
    app.use(logger('combined'));
    app.use(express.static(path.join(__dirname, '../public')));
    
    app.listen(this.port);
    console.log('listening on port ' + this.port);
  }
  getPort() {
    return this.port;
  }
}