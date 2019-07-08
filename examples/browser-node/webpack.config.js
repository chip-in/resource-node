const path = require('path');
var CORE_NODE_URL = "http://core"
module.exports = {
  context: __dirname + '/src',
  entry: './index.js',
  output: {
    filename: 'dist/bundle.js',
    path: __dirname + '/public/',
    publicPath : ""
  },
  node: {
    fs: 'empty'
  },
  devtool: 'inline-source-map',
  module: {
    rules: [
      { test: /\.css$/, loader: ["style-loader", "css-loader"] },
      { test: /\.(jpe?g|png|gif|svg|ico)(\?.+)?$/, loader: "url-loader"}
    ]
  }, 
  devServer: {
    contentBase: 'public',
    proxy: {
      /* application */
      '/a/' : {
        target: CORE_NODE_URL,
        secure: false
      },
      /* database */
      '/d/' : {
        target: CORE_NODE_URL,
        secure: false
      },
      /* request */
      '/r/' : {
        target: CORE_NODE_URL,
        secure: false,
        ws: true
      },
      /* mqtt */
      '/m' : {
        target: CORE_NODE_URL,
        secure: false,
        ws: true
      },
      /* node registration */
      '/n/' : {
        target: CORE_NODE_URL,
        secure: false
      },
      /* node configuration */
      '/c/' : {
        target: CORE_NODE_URL,
        secure: false
      }
    }
  }
};