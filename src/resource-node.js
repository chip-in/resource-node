import Logger from './util/logger';
import uuidv4 from 'uuid/v4';
import url from 'url';
import parser from 'mongo-parse';
import DirectoryService from './util/directory-service';
import LocalRequest from './conversion/local-request';
import LocalResponse from './conversion/local-response';
import ConfigLoader from './util/config-loader';
import cookie from 'cookie';
import Connection from './conn/connection';
import PNConnectom from './conn/pn-connection';

const COOKIE_NAME_TOKEN = "access_token";

/**
 * @desc リソースノードクラスはコアノードとの通信管理やサービスエンジンの起動を行う。
 */
class ResourceNode {


  /**
  * @desc コンストラクタ
  * @param {string} coreNodeURL コアノードURL
  * @param {string} nodeClassName ノードクラス
  */
  constructor(coreNodeURL, nodeClassName) {
    /**
     * @desc ロガー
     * @type {Logger}
     */
    this.logger = new Logger("ResourceNode");

    this.serviceClasses = {};

    this.serviceInstances = [];

    /**
     * @desc コアノード接続URL
     * @type {string}
     */
    this.coreNodeURL = coreNodeURL;

    /**
     * @desc ノードクラス名
     * @type {string}
     */
    this.nodeClassName = nodeClassName;

    this.nodeClassConfig = {};

    this.userId = null;

    this.password = null;

    this.jwt = null;

    this.jwtUpdatepath = null;

    /**
     * @desc 起動状態を表すフラグ
     * @type {boolean}
     */
    this.started = false;

    this.proxyDirService = new DirectoryService();

    this.localProxyMap = {};

    this.ctx = {};

    this.contextNamespace = "net.chip-in.";

    this.geoLocationTimeout = 5000;

    this.geoLocationMaximumAge = 0;

    this.geoLocationEnableHighAccuracy = false;

    this.userInfo = {};

    this.listeners = {}

    this.listenerMap = {};

  }

  /**
   * @desc リソースノードを起動する
   * @return {Promise} 起動完了または失敗時に状態遷移するPromiseオブジェクト
     @example
node.start()
  .then(() => {
    //　起動完了後の処理
    console.log("リソースノードの起動が完了しました。");
  })
  .catch((err) => {
    //　起動失敗後の処理
    console.log("リソースノードの起動中にエラーが発生しました。");
  })
});
   *
   */
  start() {
    if (this.started) {
      return Promise.resolve();
    }
    var token = this._resolveToken()
    this.conn = new Connection(this.coreNodeURL, null, this.userId, this.password, token, this.jwtUpdatepath, {
      "onConnect" : ()=>this._onConnect(),
      "onDisconnect" : ()=>this._onDisconnect(),
      "onTokenUpdate" : ()=>this._onTokenUpdate()
    });
    return Promise.resolve()
      .then(()=>this.conn.open())
      .then(()=>this._initConnectionContext())
      .then(()=>this._enableServices())
      .then(()=>this._initApplicationContext())
      .then(()=>this.started = true)
      .catch((e)=>{
        this.logger.error("Failed to start resource-node", e);
        this.stop(true)
        return Promise.reject(e);
      })
  }
  /**
   * @desc リソースノードを停止する
   * @return {Promise} 停止完了または失敗時に状態遷移するPromiseオブジェクト
     @example
node.stop()
  .then(() => {
    //　停止完了後の処理
    console.log("リソースノードの停止が完了しました。");
  })
  .catch((err) => {
    //　停止失敗後の処理
    console.log("リソースノードの停止中にエラーが発生しました。");
  })
});
   */
  stop(force) {
    if (this.conn == null) {
      return Promise.resolve();
    }
    if (!force && !this.started) {
      return Promise.resolve();
    }
    //It doesn't ensure connection
    return Promise.resolve()
      .then(()=>this._disableServices())
      .then(()=>this.conn.close())
      .then(()=> this.started = false)
  }

  /**
   * @desc サービスクラスに対応する実装クラスを登録する
   * @param {object} classes  キーにサービスクラス、値にサービスクラス実装のクラスオブジェクト
   * @example
   * // registerServiceClasses でサービスを実装するクラスを登録する
node.registerSerivceClasses({
  DatabaseRegistry,
  ContextManager,
  UpdateManager,
  SubsetStorage
});
   *
   */
  registerServiceClasses(classes) {
    if(!classes) {
      return;
    }
    for (var k in classes) {
      this.serviceClasses[k] = {
        initialize : classes[k]
      }
    }
  }

  /**
   * @desc 指定されたサービスクラス、オプションに該当するサービスクラス実装を取得する。
   * @param {string} serviceClassName 検索対象サービスクラス名
   * @param {object} [query] 検索条件とする構成情報。この引数が指定された場合、第一引数指定内容に該当するもののうち、本引数で指定された属性の値とサービスエンジンの構成情報とが一致するものが取得対象となる
   * @return {ServiceClass[]} 条件に該当するサービスクラスインスタンスの配列。該当無しの場合要素数0の配列
     @example 
// 例１：WebUi がデータベースの検索を行う場合
seList = node.searchServiceEngine("QueryRouter",{database:"alarts"});
if (seList.length != 1) {
  //TODO エラー処理
}
queryRouter = seList[0];
queryRouter.query({alartClass:"EvacuationOrder", date:{$gt:"2017-08-07T10:23:24"}}).then((resultSet) => {
  //検索完了後の処理
});

//例２：クエリルータがサブセットのクエリハンドラを順に呼ぶ例 
queryHandlers = node.searchServiceEngine("QeuryHandler", {database: this.database}); 
queryHandlers = sortQueryHandlers(queryHandlers); // サブセットの優先度順にソート 
Promise.resolve({resultSet:[],restQuery:query, queryHandlers: queryHandlers}).then(function queryFallback(result) { 
  if (! result.restQuery) return Promise.resolve(result.resultSet); // クエリが空集合なので、ここまでの結果を返す 
  if (result.queryHandlers.length == 0) {まだクエリーが空になってないのにクエリハンドラが残ってない→エラー処理} 
  var qh = queryHandlers.shift(); // 先頭のサブセットを取得 
  return qh.query(result.restQuery) // サブセットにクエリ（リモートかもしれないし、キャッシュかもしれないし、DBかもしれない） 
    .then((_resultSet) => queryFallback({ // 次のサブセットにフォールバック 
      resultSet: margeResultSet(result.resultSet, _resultSet), // サブセットのクエリの結果をここまでの結果にマージ 
      restQuery: qh.getRestQuery(result.restQuery), // 残ったクエリを計算（サブセットのクエリの否定と restQuery の論理積） 
      queryHandlers: queryHandlers // 残ったクエリハンドラ 
  })); 
}).then(resultSet =>  
   //クエリ完了後の処理
) 
   *
   */
  searchServiceEngine(serviceClassName, query) {
    return this._searchServiceEngine(serviceClassName, query);
  }

  /**
   * @desc コアノードに対してHTTPリクエストを送信する
   * @param {string} path リクエストパス
   * @param {object} [option] リクエストオプション
   * @return {Promise<resp>} HTTP応答受信後または失敗後に状態遷移するPromiseオブジェクト。
   * @see https://developer.mozilla.org/ja/docs/Web/API/Fetch_API
   *
   */
  fetch(path, option) {
    return Promise.resolve()
      .then(()=> this._fetch(path, option));
  }

  /**
   * @desc 指定したパスで逆接続プロキシを登録する
   * @param {string} path パス
   * @param {string} mode モード. "singletonMaster"(Master/Slave による冗長構成), 
   * "loadBalancing"(複数のノードによる負荷分散), "localOnly"(ノード内専用のサービス) のいずれか
   * @param {Proxy} proxy Proxyオブジェクト
   * @param {object} option：
         remount : 切断から再接続した後で自動でリマウントするフラグ（default: true）
         onDisconnect: 切断時コールバック
         onReconnect: 再接続時コールバック
         onRemount: リマウント時コールバック
   * @return {Promise<string>} 登録後または失敗後に状態遷移するPromiseオブジェクト。成功時には マウントハンドルとして使用する文字列が返る。このハンドルは、unmount時に必要となる。
   * @example 
   * 
class ProxyImpl extends Proxy {
  constructor(rnode, path) {
    super();
    this.rnode = rnode;
    this.basePath = path;
  }
  onReceive(req, res) {
    return Promise.resolve()
      .then(()=>{
        //TODO リクエスト受信後の処理
        return res;
      })
  }
}
var rnode = new ResourceNode(coreNodeUrl, "db-server");
rnode.registerServiceClasses({
  RestConnector,
  DatabaseRegistry,
  ContextManager,
  UpdateManager,
  SubsetStorage
});
var mountId = null;
rnode.start()
  .then(() => {
    rnode.logger.info("Succeeded to start resource-node");
    return Promise.resolve()
      .then(()=>rnode.mount(path, mode, new ProxyImpl(rnode, path)))  // ***** mount ***** 
      .then((mountId) => {
        rnode.logger.info("Succeeded to mount. Try to access '" + coreNodeUrl + path + "'");
      })
      .catch((e)=>{
        rnode.logger.info("Failed to mount", e);
        rnode.stop();
      })
  }).catch((e) => {
    rnode.logger.info("Failed to start resource-node", e);
    rnode.stop();
  })

   *
   */
  mount(path, mode, proxy, option) {
    if (mode !== "singletonMaster" && mode !== "loadBalancing" && mode !== "localOnly") {
      this.logger.error("Unknown mode is specified(%s)", mode);
      return Promise.reject(new Error("Unknown mode is specified"));
    }
    if (mode === "localOnly") {
      return this._localMount(path, mode, proxy, option)
        .then((mountId)=>{
          this.logger.info("Succeeded to mount:%s, %s, %s", path, mode, mountId);
          return mountId;
        })
    }
    return Promise.resolve()
      .then(()=>PNConnectom.promote(this.conn))
      .then((conn)=>this.conn = conn)
      .then(()=> this.conn.mount(path, mode, proxy, option || {}));
  }

  /**
   * @desc 指定したパスの逆接続プロキシ登録を解除する
   * @param {string} handle マウントハンドル
   * @return {Promise} 登録解除後または失敗後に状態遷移するPromiseオブジェクト。
   *
   */
  unmount(handle) {
    //It doesn't ensure connection
    if (this.localProxyMap[handle] != null) {
        return this._localUnmount(handle)
          .then(()=>{
            this.logger.info("Succeeded to unmount:%s", handle );
          })
    }
    return Promise.resolve()
      .then(()=>PNConnectom.promote(this.conn))
      .then((conn)=>this.conn = conn)
      .then(()=> this.conn.unmount(handle));
  }

  /**
   * @desc 指定したトピックを購読する
   * @param {string} topicName トピック名
   * @param {Subscriber} subscriber Subscriberオブジェクト
   * @return {Promise<string>} 購読処理完了時、unsubscribeするためのキー文字列を返すPromiseオブジェクト. 
   * @see https://www.ibm.com/developerworks/jp/websphere/library/wmq/mqtt31_spec/
   *
   */
  subscribe(topicName, subscriber) {
    return Promise.resolve()
      .then(()=>this.conn.subscribe(topicName, subscriber))
  }

  /**
   * @desc 指定したトピックの購読を終了する
   * @param {string} key 購読時に取得したキー文字列
   * @return {Promise} 購読終了処理完了時に状態遷移するPromiseオブジェクト
   * @see https://www.ibm.com/developerworks/jp/websphere/library/wmq/mqtt31_spec/
   *
   */
  unsubscribe(key) { 
    return Promise.resolve()
    .then(()=>this.conn.unsubscribe(key))
  }

  /**
   * @desc 指定したトピックにメッセージを配信する
   * @param {string} topicName トピック名
   * @param {string} message メッセージ
   * @return {Promise} 処理完了時に状態遷移するPromiseオブジェクト
   * @see https://www.ibm.com/developerworks/jp/websphere/library/wmq/mqtt31_spec/
   *
   */
  publish(topicName, message) {
    return Promise.resolve()
      .then(()=>PNConnectom.promote(this.conn))
      .then((conn)=>this.conn = conn)
      .then(()=>this.conn.publish(topicName, message))
  }

  /**
   * コアノード接続時のBASIC認証情報を設定する。
   * 
   * @param {string} userId ユーザID
   * @param {string} password パスワード
   */
  setBasicAuthorization(userId, password) {
    this.userId = userId;
    this.password = password;
  }

  setJWTAuthorization(jwt, updatePath ) {
    this.jwt = jwt;
    this.jwtUpdatepath = updatePath;
  }

  /**
   * @desc ユーザや動作環境を保持するコンテキストオブジェクトを取得する.
   * コンテキストオブジェクトには「アイデンティティ（ユーザの属性で、SAMLの属性）」「デバイス」「位置情報（ブラウザのみ）	」「環境変数（node.jsのみ）」「個別設定（ブラウザのみ、ユーザが個別に設定する設定値）」が含まれる. 取得可能なプロパティ一覧については、別紙（要作成）を参照のこと.
   * 
   * @return {object} コンテキストオブジェクト
   */
  getContext() {
    return Object.assign({}, this.ctx);;
  }

  /**
   * @desc 「個別設定（ブラウザのみ、ユーザが個別に設定する設定値）」のプロパティを設定する. 設定された内容はLocalStorageに保存される
   * @param {string} name 個別設定のプロパティ名
   * @param {*} value プロパティ値
   * @return {Promise} 処理完了後に応答するPromiseオブジェクト
   */
  setCustomParameter(name, value) {
    return Promise.resolve()
      .then(()=>{
        if (typeof localStorage === "undefined") {
          return;
        }
        localStorage.setItem(name, value);
      })
      //refresh
      .then(()=>this._initConnectionContext())
      .then(()=>this._initApplicationContext())
  }

  /**
   * @desc イベントリスナを登録する
   * @param {string} type  "disconnect"（コアノードとのWebSocket接続断。MQTT は対象外）, "connect"（コアノードとのWebSocket接続。MQTT は対象外） のみ対応  
   * @param {function} listener listener 通知リスナ
   * @return {string} リスナ解除時に指定するID
   */
  addEventListener(type, listener) {
    if (!type || typeof type !== "string") {
      throw new Error("type is not specified")
    }
    var listenerId = uuidv4();
    var listenerDef = {
      listenerId,
      listener,
      type
    };
    this.listeners[listenerId] = listenerDef
    this.listenerMap[type] = this.listenerMap[type] || [];
    this.listenerMap[type].push(listenerDef);
    this.logger.info("add eventListener:" + type + ":" + listenerId);
    return listenerId;
  }
  _onConnect() {
    this._on("connect")
  }

  _onDisconnect() {
    this._on("disconnect")
  }

  _onTokenUpdate(token) {
    if (token != null) {
      try {
        var cookies = document && document.cookie && cookie.parse(document.cookie);
        cookies[COOKIE_NAME_TOKEN] = token;
        document.cookie = cookie.serialize(COOKIE_NAME_TOKEN, token, {
          path : "/"
        });
      } catch (e) {
        //IGNORE
      }
    }
  }

  _on(type) {
    if (this.listenerMap[type]) {
      this.listenerMap[type].map((l)=>l.listener())
    }
  }

  /**
   * リスナを解除する
   * @param {string} listenerId 登録時のID
   */
  removeEventListener(listenerId) {
    if (!listenerId) {
      return;
    }
    var listenerDef =  this.listeners[listenerId];
    if (!listenerDef) {
      return;
    }
    delete this.listeners[listenerId];
    var ret = [];
    for (var i = 0; i < this.listenerMap[listenerDef.type].length; i++) {
      var l = this.listenerMap[listenerDef.type][i];
      if (l.listenerId !== listenerId) {
        ret.push(l);
      }
    }
    this.listenerMap[listenerDef.type] = ret;
    this.logger.info("remove eventListener:" + listenerDef.type + ":" + listenerId);
  }

  _initConnectionContext() {
    var ret = {};
    return Promise.resolve()
      .then(()=>this._initContextBySession(ret))
      .then(()=>this._initContextByJWT(ret))
      .then(()=>this._initContextByDevice(ret))
      .then(()=>this._initContextByGeoLocation(ret))
      .then(()=>this._initContextByEnv(ret)) /* overwrite */
      .then(()=>this._initContextByLocalStorage(ret)) /* overwrite */
      .then(()=>this.ctx=ret)
  }

  _initApplicationContext() {
    var ret = this.ctx || {};
    return Promise.resolve()
      .then(()=>this._initContextByConfig(ret))
      .then(()=>this._initContextByEnv(ret)) /* overwrite */
      .then(()=>this._initContextByLocalStorage(ret)) /* overwrite */
      .then(()=>this.ctx=ret)
  }

  _initContextBySession(ret) {
    return Promise.resolve()
    .then(()=>Object.assign(ret, this.userInfo.session))
  }

  _initContextByJWT(ret) {
    return Promise.resolve()
    .then(()=>Object.assign(ret, {
      "net.chip-in.uid" : this.userInfo.token && this.userInfo.token.sub
    }))
    .then(()=>Object.assign(ret, this.userInfo.token))
  }

  _initContextByDevice(ret) {
    return Promise.resolve()
    .then(()=>ret[this.contextNamespace + "dev"] = this.userInfo.device)/* XXX for compatibility */
    .then(()=>Object.assign(ret, this.userInfo.devinfo))
  }
  
  _initContextByConfig(ret) {
    return Promise.resolve()
    .then(()=>Object.assign(ret, {
      "net.chip-in.node-class" : this.nodeClassName,
      "net.chip-in.node-class-config" : this.nodeClassConfig
    }))
  }
  
  _initContextByGeoLocation(ret) {
    return Promise.resolve()
    .then(()=>{
      if (typeof navigator === "undefined" || typeof navigator.geolocation === "undefined" || typeof navigator.geolocation.getCurrentPosition !== "function") {
        return;
      }
      return new Promise((resolve, reject)=>{
        navigator.geolocation.getCurrentPosition((pos)=>{
          //convert Position object to native object
          ret[this.contextNamespace + "currentPosition"] = {
            timestamp: pos.timestamp,
            coords: {
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude,
              altitudeAccuracy: pos.coords.altitudeAccuracy,
              heading: pos.coords.heading,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              speed: pos.coords.speed
            }
          };
          resolve();
        }, (e)=>{
          this.logger.warn("Failed to getCurrentPosition(%s)", e.code, e);
          //IGNORE
          resolve();
        },{
          timeout : this.geoLocationTimeout,
          maximumAge : this.geoLocationMaximumAge,
          enableHighAccuracy : this.geoLocationEnableHighAccuracy
        })
      });
    })
  }

  _initContextByEnv(ret) {
    return Promise.resolve()
    .then(()=>{
      if (typeof process === "undefined" || typeof process.env === "undefined") {
        return;
      }
      for(var k in process.env) {
        ret[k] = process.env[k];
      }
    })
  }

  _initContextByLocalStorage(ret) {
    return Promise.resolve()
    .then(()=>{
      if (typeof localStorage === "undefined") {
        return;
      }
      for (var i = 0; i < localStorage.length; i++){
        var key = localStorage.key(i);
        var value = localStorage.getItem(key);
        ret[key] = value;
      }
    })
  }

  _searchServiceEngine(serviceClassName, query) {
    var ret = [];
    this.serviceInstances.reduce((dst, a)=> {
      if (a["class"] == serviceClassName &&
        (query == null || this._isMatch(a.config, query))) {
          dst.push(a.instance);
        }
      return dst;
    }, ret)
    return ret;
  }
  _isMatch(config, filter) {
    if (!filter || Object.keys(filter).length === 0) {
      //all accept
      return true;
    }
    var ret = parser.parse(filter).matches(config, false);
    return ret;
  }

  _enableServices() {
    return Promise.resolve()
      .then(()=>this._searchNodeClass(this.nodeClassName))
      .then((conf)=>this._createServiceClassInstance(conf))
      .then(()=>this._startServiceClasses());
  }

  _searchNodeClass(nodeClassName) {
    return Promise.resolve()
      .then(()=>new ConfigLoader(this).load(nodeClassName))
      .then((conf)=>{
        this.nodeClassConfig = conf;
        return conf;
      })
  }

  _createServiceClassInstance(conf) {
    return Promise.resolve()
      .then(()=>{
        var engineConfigs = conf.serviceEngines;
        if (!engineConfigs || engineConfigs.length === 0) {
          this.logger.warn("serviceEngine definition not found.");
          return;
        }
        engineConfigs.forEach((config) => {
          var className = config["class"];
          if (this.serviceClasses[className] == null) {
            throw new Error("serviceClass(" + className + ") is not defined.")
          }
          var def = {
            "class" : className,
            "config" : config,
            "instance" : new this.serviceClasses[className].initialize(config)
          }
          this.serviceInstances.push(def);
        });
      })
  }

  _startServiceClasses() {
    return Promise.resolve()
      .then(() => this.serviceInstances
        .sort((a, b) => (a.instance.bootOrder ? a.instance.bootOrder : 99999) - (b.instance.bootOrder ? b.instance.bootOrder : 99999))
        .reduce((prev, current) => {
          return prev.then(() => current.instance.start(this))
        }, Promise.resolve()))
  }

  _fetch(path, option) {
    if (!path || typeof path !== "string") {
        return Promise.reject("Path must be string");
    }
    var href = path;
    if ( path.indexOf("/") === 0) {
      href = url.resolve(this.coreNodeURL, path);
    } else if (path.indexOf("http://") !== 0 &&
                path.indexOf("https://") !== 0) {
        return Promise.reject("Invalid url is specified:%s", path);
    }

    var urlObj = url.parse(href);
    var localService = null;
    if (this._isCoreNodeRequest(urlObj)  &&
      (localService = this.proxyDirService.lookup(urlObj.path)) != null) {
        return this._localFetch(path, option, localService);
    }

    return this.conn.fetch(href, option);
  }

  _isCoreNodeRequest(urlObj) {
    var corenodeUrlObj = url.parse(this.coreNodeURL);
    var defaultPort = corenodeUrlObj.protocol.indexOf("https:") === 0 ? "443" : "80";
    return (urlObj.protocol === corenodeUrlObj.protocol &&
      urlObj.hostname.toLocaleLowerCase() === corenodeUrlObj.hostname.toLowerCase() &&
      (urlObj.port || defaultPort) === (corenodeUrlObj.port || defaultPort));
  }

  _localFetch(requestHref, option, localService) {
    this._convertHeaderToLowerCase(option);
    var req = new LocalRequest(requestHref, option);
    var res = new LocalResponse(req);
    return localService.proxy.onReceive(req, res)
  }

  _resolveToken() {
    var token = this.jwt;
    if (token == null) {
      try {
        var cookies = document && document.cookie && cookie.parse(document.cookie);
        if (cookies && cookies[COOKIE_NAME_TOKEN]) {
          token = cookies[COOKIE_NAME_TOKEN];
        }
      } catch (e) {
        //IGNORE
      }
    }
    return token;
  }

  _updateToken(token) {
    this.jwt = token;
    if (token != null) {
      try {
        var cookies = document && document.cookie && cookie.parse(document.cookie);
        cookies[COOKIE_NAME_TOKEN] = token;
        document.cookie = cookie.serialize(COOKIE_NAME_TOKEN, token, {
          path : "/"
        });
      } catch (e) {
        //IGNORE
      }
    }
  }

  _convertHeaderToLowerCase(option) {
    if (option == null) {
      return;
    }
    var headers = option.headers;
    if (!headers) {
      return;
    }
    var ret = {};
    for (var k in headers) {
      ret[k.toLowerCase()] = headers[k];
    }
    option.headers = ret;
  }

  _disableServices() {
    //unmount all
    return Promise.resolve()
    .then(()=>this.conn.unmountAll())
    .then(()=>this.conn.unsubscribeAll())
  }
  
  _localMount(path, mode, proxy, option) {
    var handle = uuidv4();
    return Promise.resolve()
      .then(()=>{
        var dst  = this.proxyDirService.lookup(path);
        if (dst != null) {
          this.logger.info("remount " + path);
        }
        this.proxyDirService.bind(path, {
          handle, proxy
        });
        this.localProxyMap[handle] = path;
        return handle;
      })
  }
  
  _localUnmount(handle) {
    return Promise.resolve()
      .then(()=>{
        var path = this.localProxyMap[handle];
        if (path == null) {
          this.logger.info("path not found (to unmount locally)")
          return ;
        }
        this.proxyDirService.unbind(path);
        delete this.localProxyMap[handle];
      });
  }

}

export default ResourceNode