const path = require('path');
var CORE_NODE_URL = "http://test-core.chip-in.net"
module.exports = {
  entry: './src/index.js',
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, './public/dist')
  },
  node: {
    fs: 'empty'
  },
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [
          'style-loader',
          'css-loader'
        ]
      }, {
        test: /\.(jpe?g|png|gif|svg|ico)(\?.+)?$/,
        use: {
            loader: 'url-loader',
            options: {
                name: './img/[name].[ext]'
            }
        }
    }
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
        secure: false
      },
      /* mqtt */
      '/m/' : {
        target: CORE_NODE_URL,
        secure: false
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