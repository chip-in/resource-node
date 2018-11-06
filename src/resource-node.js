import Logger from './util/logger';
import ioClient from 'socket.io-client';
import uuidv4 from 'uuid/v4';
import ServiceEngine from './api/service-engine';
import url from 'url';
import WSResponse from './conversion/ws-response';
import WSRequest from './conversion/ws-request';
import mqtt from 'mqtt';
import parser from 'mongo-parse';
import DirectoryService from './util/directory-service';
import querystring from 'querystring';
import LocalRequest from './conversion/local-request';
import LocalResponse from './conversion/local-response';
import ConfigLoader from './util/config-loader';
import {fetchImpl, fetchOption} from './util/fetch';
import cookie from 'cookie';

const COOKIE_NAME_TOKEN = "access_token";

var decodeJwt = function (jwt) {
  return JSON.parse(new Buffer(jwt.split(".")[1], "base64").toString());
}

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

    /**
     * @desc コアノードとの接続状態を表すフラグ
     * @type {boolean}
     */
    this.isConnected = false;

    this.proxies = {};

    this.webSocketMsgName = process.env.CNODE_WSOCKET_MSG_NAME || 'ci-msg';    

    this.mqttConnections = {};

    this.mqttClientConnections = {};

    this.sessionTable = {};

    this.proxyDirService = new DirectoryService();

    this.localProxyMap = {};

    this.ctx = {};

    this.operationQueue = [];

    this.contextNamespace = "net.chip-in.";

    this.geoLocationTimeout = 5000;

    this.geoLocationMaximumAge = 0;

    this.geoLocationEnableHighAccuracy = false;

    this.userInfo = {};

    this.listeners = {}

    this.listenerMap = {};

    this.mountIdMap = {};

    this.mountListenerMap = {};
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
    return Promise.resolve()
      .then(()=>this._tryToJoinCluster())
      .then(()=>this._ensureConnected())
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
    if (!force && !this.started) {
      return Promise.resolve();
    }
    //It doesn't ensure connection
    return Promise.resolve()
      .then(()=>this._disableServices())
      .then(()=>this._leaveCluster())
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
      .then(()=>this._ensureConnected())
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
    return Promise.resolve()
      .then(()=>this._ensureConnected())
      .then(()=> this._mount(path, mode, proxy, option || {}));
  }

  /**
   * @desc 指定したパスの逆接続プロキシ登録を解除する
   * @param {string} handle マウントハンドル
   * @return {Promise} 登録解除後または失敗後に状態遷移するPromiseオブジェクト。
   *
   */
  unmount(handle) {
    //It doesn't ensure connection
    return Promise.resolve()
      .then(()=> this._unmount(handle));
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
    var key = uuidv4();
    return Promise.resolve()
    .then(()=>this._ensureConnected())
    .then(()=>{
      return new Promise((resolve, reject) => {
        var responded = false;
        var mqttUrl = this._createMQTTUrl();
        var mqttConnectOption = this._createMQTTConnectOption();
        var client = mqtt.connect(mqttUrl, mqttConnectOption);
        var subscribed = false;
        client.on("connect", (connack) => {
          if (!subscribed) {
            client.subscribe(topicName, {qos: 1}, (e, g) => {
              subscribed = true;
              this.logger.info("subcribe topic(%s):error=%s:granted=%s", topicName, e, JSON.stringify(g))
              if (!responded) {
                responded = true;
                resolve(key);
              }
            })
            client.on("message", (topic, message, packet) => {
              subscriber.onReceive(message);
            });
            client.on("error", (e)=>{
              this.logger.info("Failed to subscribe", e);
              if (!responded) {
                responded = true;
                reject(e)
              }
            })
          }
        });
        this.mqttConnections[key] = {
          client, topicName
        };
        this.logger.info("bind mqtt topic and key(%s : %s)", topicName, key);
      })
    })
  }

  _createMQTTUrl() {
    var mqttProto = process.env.CNODE_MQTT_PROTO || ((this.coreNodeURL.indexOf("https://") === 0) ? 'wss' : 'ws');
    var coreUrl = url.parse(this.coreNodeURL);
    var coreHost = coreUrl.host;
    var port = process.env.CNODE_MQTT_PORT ? (":" + process.env.CNODE_MQTT_PORT) : '';
    var mqttPath = process.env.CNODE_MQTT_PATH || "/m";

    return [mqttProto,"://",coreHost,port,mqttPath].join("");
  }
  /**
   * @desc 指定したトピックの購読を終了する
   * @param {string} key 購読時に取得したキー文字列
   * @return {Promise} 購読終了処理完了時に状態遷移するPromiseオブジェクト
   * @see https://www.ibm.com/developerworks/jp/websphere/library/wmq/mqtt31_spec/
   *
   */
  unsubscribe(key) { 
    var def = this.mqttConnections[key];
    if (def == null) {
      this.logger.warn("Key not found:%s", key);
      return Promise.resolve();
    }
    //It doesn't ensure connection
    return Promise.resolve()
      .then(()=>{
      return new Promise((resolve, reject) => {
        def.client.unsubscribe(def.topicName, (e)=>{
          def.client.end();
          delete this.mqttConnections[key];
          if (e) {
            this.logger.warn("Failed to unsubscribe topic:(%s : %s)", def.topicName, key, e);
            reject(e);
            return;
          }
          this.logger.info("Succeeded to unsubscribe topic(%s : %s)", def.topicName, key);
          resolve();
        })
      });
    })
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
    var key = uuidv4();
    return Promise.resolve()
    .then(()=>this._ensureConnected())
    .then(()=>{
      return new Promise((resolve, reject)=>{
        var mqttUrl = this._createMQTTUrl();
        var mqttConnectOption = this._createMQTTConnectOption();
        var client = mqtt.connect(mqttUrl, mqttConnectOption);
        client.on("connect", ()=>{
          client.publish(topicName, message, {qos: 1, retain: true}, (e)=>{
            client.end();
            delete this.mqttClientConnections[key];
            if (e) {
              this.logger.error("Failed to publish(%s)", topicName, e);
              reject(e);
              return;
            }
            this.logger.info("Succeeded to publish(%s)", topicName)
            resolve();
          })
        }); 
        client.on("error", (e) => {
          delete this.mqttClientConnections[key];
          this.logger.info("Failed to publish", e);
          reject(e);
        })
        this.mqttClientConnections[key] = client;
      });
    })
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
    this._startJWTRefreshProcess();
  }
  _startJWTRefreshProcess() {
    if (this.jwt == null) {
      return;
    }
    if (this.isRefreshRunning) {
      return;
    }
    this.isRefreshRunning = true;
    var path = this.jwtUpdatepath || "/core.JWTUpdate"
    if (path.indexOf("/") !== 0) {
      path = "/" + path;
    }
    var url = this.coreNodeURL + path;
    try {
      var that = this;
      var refreshToken = function refreshToken() {
        var option = {mode: 'cors'};
        that._setAuthorizationHeader(option);
        fetchImpl(url, option)
          .then(function(response) {
            if (response.status == 401) {
              return Promise.reject("invalid session");
            } else if (! response.ok) {
              return Promise.reject("Failed to refresh token" +  response.statusText);
            }
            return response.json();
          })
          .then(result => {
            that.jwt = result.access_token;
            setTimer();
          }).catch(function(reason) {
            that.logger.error("fail! reason=" + reason);
          });
      }
      var setTimer = function setTimer() {
        var token = decodeJwt(that.jwt);
        var currentMills = new Date().getTime();
        var currentTime = Math.round(currentMills / 1000);
        that.logger.info("current time = " + currentTime + " token.exp = " + token.exp);
        if (token.exp < currentTime) {
          that.logger.info("token is expired, so reload this iframe");
          refreshToken();
          return;
        }
        var timeout = (token.exp - currentTime - 60) * 1000;
        that.logger.info("set timer at 1 minutes ahead of expiration " + new Date(currentMills + timeout).toLocaleString());
        setTimeout(refreshToken, timeout)
      }
      setTimer();
    }catch (e) {
      that.logger.error("Failed to start JWT refresh process", e)
    }
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
    option = Object.assign({}, fetchOption, option);
    this._normalizeHeader(option);
    this._setAuthorizationHeader(option);

    var urlObj = url.parse(href);
    var localService = null;
    if (this._isCoreNodeRequest(urlObj)  &&
      (localService = this.proxyDirService.lookup(urlObj.path)) != null) {
        return this._localFetch(path, option, localService);
    }
    return fetchImpl(href, option);
   
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

  _createMQTTConnectOption() {
    var wsOptions = {}
    this._setAuthorizationHeader(wsOptions);

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
    var ret = {
      keepalive: 30,
      wsOptions
    };

    if (token == null) {
      return ret;
    }
    ret.username = token;
    return ret;
    
  }
  _setAuthorizationHeader(option) {
    if (option == null) {
      return;
    }
    var headers = option.headers;
    if (!headers) {
      headers = option.headers = {};
    }
    if (this.jwt != null) {
      headers['Authorization'] = 'Bearer ' + this.jwt;
    } else if (this.userId != null && this.password != null) {
      headers['Authorization'] = 'Basic ' + new Buffer(this.userId + ":" + this.password).toString("base64");
    }
  }

  _normalizeHeader(option) {
    if (option == null) {
      return;
    }
    var headers = option.headers;
    if (!headers) {
      headers = option.headers = {};
    }
    var tmp = {};
    //convert to native object
    if (typeof headers.getAll === "function") {
      tmp = {};
      for (var k in Object.keys(headers)) {
        var val = headers.getAll(k);
        tmp[k] = val.length > 1 ? val : val[0];
      }
    } else if (headers && typeof headers === "object" ) {
      tmp = Object.assign(tmp, headers);
    }
    option.headers = tmp;
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

  _tryToJoinCluster() {
    return Promise.resolve()
      .then(()=>{
        var webSocketPath = process.env.CNODE_WSOCKET_PATH || '/r';
        var headerOpts = {};
        this._setAuthorizationHeader(headerOpts);
        var socket = ioClient(this.coreNodeURL,{
          path : webSocketPath,
          extraHeaders : headerOpts.headers
        });
        //ResourceNode distinguishes connection-status from resource-node-startup-status.
        socket.on('connect', ()=>{
          this.logger.warn("connected to core-node via websocket");
          //start clustering
          this._register()
            .then(()=>{
              this.isConnected = true;
              this._notifyConnected()
              .then(()=>{
                if (this.listenerMap["connect"]) {
                  this.listenerMap["connect"].map((l)=>l.listener())
                }
              })
            })
        });
        socket.on('disconnect', ()=>{
          this.logger.warn("disconnected to core-node via websocket");
          this.isConnected = false;
          if (this.listenerMap["disconnect"]) {
            this.listenerMap["disconnect"].map((l)=>l.listener())
          }
        });
        socket.on(this.webSocketMsgName, (msg) =>{
          this._receive(msg);
        });

        this.socket = socket;
      });
  }

  _register() {
    return Promise.resolve()
      .then(()=>{

      var uuid = this.nodeId || uuidv4();
      var registerMsg = {
        i: uuid,
        s : "ClusterService",
        t : "register"
      };
      return this._ask(registerMsg)
        .then((resp)=>{
          if (resp.t !== "registerResponse") {
            this.logger.error("Failed to register. Received unexpected response:%s", JSON.stringify(resp));
            throw new Error("Failed to register. Received unexpected response");
          }
          if (!resp.m || resp.m.rc !== 0) {
            this.logger.error("Failed to register. Received unexpected result code:%s", JSON.stringify(resp));
            throw new Error("Failed to register. Received unexpected result code");
          }
          this.logger.info("Succeeded to register cluster");
          this.nodeId = uuid;
          this.userInfo = resp.u || {};
        });
    });
  }
  _receive( msg) {
    return new Promise((resolve, reject) => {
      var isAsk = msg.a;
      if (isAsk && this.sessionTable[msg.i]) {
        //answer
        var session = this.sessionTable[msg.i];
        delete this.sessionTable[msg.i];
        session.end(msg);
        resolve();
        return;
      }
      if (msg.s && msg.s.indexOf("ProxyService:/") === 0 && msg.t !== "request") {
        this.logger.error("unexpected service(%s) and type(%s)", msg.s, msg.t);
        return;
      }
      var mountId = msg.m.mountId;
      var proxy = this.proxies[mountId];
      var req = new WSRequest(msg);
      var resp = new WSResponse(msg, req);
      if (!proxy) {
        this.logger.warn("proxy instance not found");
        resp.status(404).end();
        return;
      }
      var promise = proxy.onReceive(req, resp);
      if (promise) {
        promise.then((resp)=>{
          if (!resp) {
            this.logger.warn("Response is empty");
            return;
          }
          var respMsg = Object.assign({}, msg);
          respMsg.m = Object.assign({}, resp);
          respMsg.t = "response";
          this._send(respMsg);
          resolve();
        }).catch((e)=>{
          this.logger.error("Failed to proxy service", e);
        });
      }
      });
  }
  _leaveCluster() {
    return Promise.resolve()
      .then(()=>this._unregister())
      .then(()=>this._closeSocket());
  }

  _unregister() {
    return Promise.resolve()
      .then(()=>{
        if (!this.socket.connected) {
          return Promise.resolve();
        }
        var uuid = uuidv4();
        var unregisterMsg = {
          i : uuid,
          s : "ClusterService",
          t : "unregister"
        };
        return this._ask(unregisterMsg)
          .then((resp)=>{
            if (resp.t !== "unregisterResponse") {
              this.logger.error("Failed to unregister. Received unexpected response:%s", JSON.stringify(resp));
              //IGNORE
            } else if (!resp.m || resp.m.rc !== 0) {
              this.logger.error("Failed to unregister. Received unexpected result code:%s", JSON.stringify(resp));
              //IGNORE
            }
            this.logger.info("Succeeded to unregister cluster");
            return Promise.resolve();
          });
      })
  }

  _closeSocket() {
    return Promise.resolve()
      .then(()=>{
        var sock = this.socket;
        if (!sock) {
          return;
        }
        this.socket = null;
        sock.close();
      });
  }

  _disableServices() {
    //unmount all
    return Promise.all(Object.keys(this.proxies).map((p)=>this._unmount(p)))
      .then(()=>Array.prototype.slice.call(this.serviceInstances).reverse().reduce((prev, current)=>{
        return prev.then(()=>current.instance.stop(this))
      }, Promise.resolve()))
      .then(()=>{
        this.serviceInstances = [];
      })
      .then(()=>{
        return Promise.all(Object.keys(this.mqttConnections).map((k)=>{
          var def = this.mqttConnections[k];
          def.client.unsubscribe(def.topicName, (e)=>{
          if (e) {
            this.logger.warn("Failed to unsubscribe topic", e);
          } else {
            this.logger.info("Unsubscribe topic on shutdown(%s:%s)", def.topicName, k);
          }
          def.client.end();
        })}))
        .then(()=>{
          this.mqttConnections = {};
        })
      })
      .then(()=>{
        for (var k in this.mqttClientConnections) {
          this.mqttClientConnections[k].end();
        }
      })
  }
  
  _mount(path, mode, proxy, option, internal) {
    if (mode === "localOnly") {
      return this._localMount(path, mode, proxy, option);
    }
    var key = uuidv4();
    return Promise.resolve()
      .then(()=>this._ask({
        i : key,
        s : "ProxyService",
        t : "mount",
        m : {
          path : path,
          mode : mode
        }
      }))
      .then((resp) => {
        if (resp.t !== "mountResponse") {
          this.logger.error("Failed to mount. Received unexpected response:%s", JSON.stringify(resp));
          throw new Error("Failed to mount. Received unexpected response");
        }
        if (!resp.m || resp.m.rc !== 0) {
          this.logger.error("Failed to mount. Received unexpected result code:%s", JSON.stringify(resp));
          throw new Error("Failed to mount. Received unexpected result code");
        }
        var mountId = resp.m.mountId;
        if (!mountId) {
          this.logger.error("Failed to mount. MountId not found:%s", JSON.stringify(resp));
          throw new Error("Failed to mount. MountId not found");
        }
        this.logger.info("Succeeded to mount:%s, %s, %s", path, mode, mountId);
        this.proxies[mountId] = proxy;
        return mountId;
    })
    .then((mountId)=>{
      if (internal) {
        return mountId;
      }
      this.mountIdMap[mountId] = mountId;
      var addListener = (func, type) =>{
        if (typeof func === "function") {
          return this.addEventListener(type, ()=>{
            this.logger.debug(type + " event:"+mountId);
            try {
              func(mountId);
            } catch (e) {
              this.logger.warn(type + " listener error", e);
              //IGNORE
            }
          })
        }
      }
      var disconnectId = addListener(option.onDisconnect, "disconnect");
      var connectId = addListener(option.onReconnect, "connect");
      var remountId = null;
      if (option.remount == null || option.remount) {
        remountId = addListener(()=>{
          var prev = this.mountIdMap[mountId];
          this._unmount(prev, true)
          .then(()=>this._mount(path, mode, proxy, option, true))
          .then((newMountId)=>{
            this.mountIdMap[mountId] = newMountId;
            if (option.onRemount) {
              try {
                option.onRemount(mountId);
              } catch (e) {
                this.logger.warn("remount callback error", e);
                //IGNORE
              }
            }
          })
        }, "connect");
      }      
      this.mountListenerMap[mountId] = [disconnectId, connectId, remountId].filter((s)=>{return s != null;})
      return mountId;
    })
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

  _unmount(handle, internal) {
    if (this.localProxyMap[handle] != null) {
        return this._localUnmount(handle);
    }
    var realHandle = internal? handle : this.mountIdMap[handle];
    var key = uuidv4();
    return Promise.resolve()
      .then(()=>this._ask({
        i : key,
        s : "ProxyService",
        t : "unmount",
        m : {
          mountId : realHandle
        }
      }))
      .then((resp) => {
        if (resp.t !== "unmountResponse") {
          this.logger.error("Failed to unmount. Received unexpected response:%s", JSON.stringify(resp));
          throw new Error("Failed to unmount. Received unexpected response");
        }
        if (!resp.m || resp.m.rc !== 0) {
          this.logger.error("Failed to unmount. Received unexpected result code:%s", JSON.stringify(resp));
          throw new Error("Failed to unmount. Received unexpected result code");
        }
        this.logger.info("Succeeded to unmount:%s", handle + "(" + realHandle + ")");
        delete this.proxies[realHandle];
    })
    .then(()=>{
      if (internal) {
        return ;
      }
      var ids = this.mountListenerMap[handle] 
      if (ids) {
        ids.map((i)=>this.removeEventListener(i));
      }
      delete this.mountListenerMap[handle] ;
      delete this.mountIdMap[handle] ;
      
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

  _ask(msg) {
    return new Promise((resolve, reject)=>{
      this.sessionTable[msg.i] = {
        end : (resp)=>{
          resolve(resp);
        }
      }
      Promise.resolve()
        .then(()=>this._send(Object.assign({a : true}, msg)))
    });
    
  }

  _send(msg) {
    return Promise.resolve()
      .then(()=>this.socket.emit(this.webSocketMsgName, msg));
  }

  _ensureConnected(timeout) {
    return new Promise((resolve, reject)=>{
      if (this.isConnected) {
        this.logger.debug("ensureConnection: OK")
        resolve();
        return;
      }
      this.logger.debug("ensureConnection: NG")
      var operation = {
        resolve, expired : false
      };
      this.operationQueue.push(operation);
      if (timeout) {
        var timeoutId = setTimeout(()=>{
          reject(new Error("Connection timeout"));
          operation.expired = true;
        }, timeout);
        operation.timeoutId = timeoutId;
      }
    });
  }
  _notifyConnected() {
    this.logger.debug("Connected. So we notify waiter")
    var target = this.operationQueue;
    //clear
    this.operationQueue = [];
    return Promise.resolve()
      .then(()=>{
        target.map((op)=>{
          if (!op.expired) {
            op.resolve();
            if (op.timeoutId) {
              clearTimeout(op.timeoutId);
            }
          }
        });
      })
  }
}

export default ResourceNode