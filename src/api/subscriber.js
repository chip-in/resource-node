import Logger from '../util/logger';

/**
 * @desc MQTTメッセージ受信後のコールバック処理クラスのインタフェース
 */
export default class Subscriber {
  
  /**
   * @desc コンストラクタ
   */
  constructor() {
    /**
     * @desc ロガー
     * @type {Logger}
     */
    this.logger = new Logger("Subscriber");
  }
  /**
   * @desc メッセージ受信後のコールバック関数
   * @param {string} msg メッセージ
   * @abstract
   *
   *
   */
  onReceive(msg) {
    
  }
}
