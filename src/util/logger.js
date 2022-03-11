import util from 'util';

var pmap = {
  "DEBUG" : 10,
  "INFO" : 20,
  "WARN" : 30,
  "ERROR" : 40
}

var priority = pmap[process.env.CNODE_LOG_LEVEL] || pmap["INFO"];

var logging = function() {
  var msgs = [new Date().toISOString()
    ,(arguments[0] + "   ").substr(0, 5)
    ,"["+ (arguments[1] + " ".repeat(20)).substr(0, 20) + "]"
    ,util.format.apply(util, Array.prototype.slice.apply(arguments, [2]))];

  console.log(msgs.join(" "));
}

/**
 * @desc  ロガークラス
 */
class Logger {
  constructor(category) {
    this.category = category || "";
  }
  
  _isEnabled(level) {
    var p = pmap[level] || 0;
    return p >= priority;
  }
  /**
   * @desc デバッグレベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  debug(msg, substN) {/*eslint-disable-line no-unused-vars*/
    var level = "DEBUG";
    if(this._isEnabled(level)) logging.apply(null, [level, this.category].concat(Array.prototype.slice.call(arguments)));
  }

  /**
   * @desc 情報レベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  info(msg, substN) {/*eslint-disable-line no-unused-vars*/
    var level = "INFO";
    if(this._isEnabled(level)) logging.apply(null, [level, this.category].concat(Array.prototype.slice.call(arguments)));
  }

  /**
   * @desc 警告レベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  warn(msg, substN) {/*eslint-disable-line no-unused-vars*/
    var level = "WARN";
    if(this._isEnabled(level)) logging.apply(null, [level, this.category].concat(Array.prototype.slice.call(arguments)));
  }

  /**
   * @desc エラーレベルログを出力する
   * @param  msg 0 個以上の置換文字列 (substitution strings)を含む JavaScript 文字列
   * @param  substN JavaScript オブジェクトと msg 内の置換文字列を置換。これにより、出力の書式の詳細な制御が可能となります。可変長で、N個のパラメータを指定できる。
   *
   */
  error(msg, substN) {/*eslint-disable-line no-unused-vars*/
    var level = "ERROR";
    if(this._isEnabled(level)) logging.apply(null, [level, this.category].concat(Array.prototype.slice.call(arguments)));
  }

}
export default Logger