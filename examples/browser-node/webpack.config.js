const webpack = require('webpack');
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
      {
        test: /\.js$/, exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                ['@babel/preset-env', {"targets": {"node": "current"}}]
              ]
            }
          }
        ]
      },
      { test: /\.css$/, loader: ["style-loader", "css-loader"] },
      { test: /\.(jpe?g|png|gif|svg|ico)(\?.+)?$/, loader: "url-loader"}
    ]
  }, 
  plugins: [
    new webpack.DefinePlugin({
      "process.env" : {
        IGNORE_CORENODE_CLUSTERING_ERROR: "true"
      }
    })
  ],
  devServer: {
    contentBase: 'public',
    proxy: [
      /* application */
      {
        context: '/a/' ,
        target: CORE_NODE_URL,
        secure: false
      },
      /* database */
      {
        context: '/d/',
        target: CORE_NODE_URL,
        secure: false
      },
      /* request */
      {
        context: '/r/',
        target: CORE_NODE_URL,
        secure: false,
        ws: true
      },
      /* mqtt */
      {
        context: (pathName, req)=>pathName === '/m',
        target: CORE_NODE_URL,
        secure: false,
        ws: true
      },
      /* node registration */
      {
        context: '/n/',
        target: CORE_NODE_URL,
        secure: false
      },
      /* node configuration */
      {
        context: '/c/',
        target: CORE_NODE_URL,
        secure: false
      },
      /* logging*/
      {
        context: '/l/',
        target: CORE_NODE_URL,
        secure: false
      },
      /* consul */
      {
        context: '/v1/',
        target: CORE_NODE_URL,
        secure: false
      }
    ]
  }
};