const path = require('path');

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
  }
};