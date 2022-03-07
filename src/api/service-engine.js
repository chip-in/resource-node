import Logger from '../util/logger';

/**
 * @desc サービスエンジン実装のインタフェース
 */
class ServiceEngine {
  /**
   * @desc コンストラクタ
   * @param {object} [option] コアノードに登録された構成情報
   */
  constructor(option) {/*eslint-disable-line no-unused-vars*/
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * @desc サービスエンジンを起動する
   * @param {ResourceNode} node リソースノード
   * @return {Promise} 起動完了後に状態遷移するPromiseオブジェクト
   * @abstract
     @example
//実装例
export default class WebUiEngine extends ServiceEngine {
  start(node) {
     return Promise.all([
       //MQTTサブスクライブ
       node.subscribe("example", new SubscriberImpl()),
       //Proxy実装をリソースノードにマウント
       node.mount("/", new ProxyImpl())
     ]);
  }
}
   *
   */
  start(node) {/*eslint-disable-line no-unused-vars*/
    return Promise.resolve();
  }

  /**
   * @desc サービスエンジンを終了する
   * @param {ResourceNode} node リソースノード
   * @return {Promise} 終了後に状態遷移するPromiseオブジェクト
   * @abstract
     @example
//実装例
export default class WebUiEngine extends ServiceEngine {
  start(node) {
     return Promise.all([
       //MQTTアンサブスクライブ
       node.unsubscribe("example"),
       //Proxy実装をリソースノードからアンマウント
       node.unmount("/")
     ]);
     
  }
}
   *
   */
  stop(node) {/*eslint-disable-line no-unused-vars*/
    return Promise.resolve();
  }

}
export default ServiceEngine