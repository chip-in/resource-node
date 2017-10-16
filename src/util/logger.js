import util from 'util';
import winston from 'winston';

var defaultOption = {
  transports: [
    new (winston.transports.Console)({
      level: 'info',
      formatter : function(options) {
        return [new Date().toISOString()
        ,(options.level + "   ").substr(0, 5)
        ,"["+ (options.meta.category + " ".repeat(20)).substr(0, 20) + "]"
        , options.message
        ].join(" ");
      }
    })
  ]
}
/**
 * @desc  ロガークラス
 */
class Logger {
  constructor(category) {
    this.category = category || "";
    this.meta = {category};
    this.delegate = winston.loggers.get(category, Object.assign({},defaultOption));
  }
  
  /**
   * @desc デバッグレベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  debug(msg, substN) {
    this.delegate.log("debug", util.format.apply(util, Array.prototype.slice.apply(arguments)), this.meta);
  }

  /**
   * @desc 情報レベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  info(msg, substN) {
    this.delegate.log("info", util.format.apply(util, Array.prototype.slice.apply(arguments)), this.meta);
  }

  /**
   * @desc 警告レベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  warn(msg, substN) {
    this.delegate.log("warn", util.format.apply(util, Array.prototype.slice.apply(arguments)), this.meta);
  }

  /**
   * @desc エラーレベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  error(msg, substN) {
    this.delegate.log("error", util.format.apply(util, Array.prototype.slice.apply(arguments)), this.meta);
  }

}
export default Logger