import Logger from '../util/logger';

/**
 * @desc MQTTメッセージ受信後のコールバック処理クラスのインタフェース
 */
class Subscriber {
  
  /**
   * @desc コンストラクタ
   */
  constructor() {
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
export default Subscriber 