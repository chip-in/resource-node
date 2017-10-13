import Logger from '../util/logger';

/**
 * @desc 逆接続プロキシのリクエスト受信後のコールバック処理クラスのインタフェース
*/
class Proxy {
  constructor() {
    this.logger = new Logger("Proxy");
  }
  /**
   * @desc リクエスト受信時に呼び出されるコールバック関数
   * @param {http.IncomingMessage} req HTTPリクエスト
   * @param {http.ServerResponse} res HTTPレスポンス
   * @return {Promise<http.ServerResponse>} 処理完了後、responseを返すPromiseオブジェクト
   * @see https://nodejs.org/dist/latest-v8.x/docs/api/http.html
   * @abstract
   * @example 
//実装例
class WebUi extends Proxy {
	onReceive (req, res) {
		return new Promise((resolve, reject)=>{
			//（注）リクエストに応じた処理を行い、レスポンスを生成する処理を記述する。
			resolve(res);
		});
	}
}
   
   *
   */
  onReceive(req, res) {
    return Promise.resolve(res);
  }
}
export default Proxy