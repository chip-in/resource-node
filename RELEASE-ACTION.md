# リリース手順

Github Action を利用したバージョニングとリリース管理を、chip-in の各リポジトリに適用します。

## 前提

-  [[github-flow:https://gist.github.com/Gab-km/3705015]] + 旧互換ブランチを採用する
-  メインブランチ更新の際には、pull request を使う
-  バージョン番号は  [[semver:https://semver.org/lang/ja/]] に準拠する

## バージョニング

### 目標

- 開発者が、バージョンアップにかかるコマンド類(git tag など) を実行しなくてよいこと。またバージョン番号について、自動で付番されること
- 開発者が、メジャーバージョン、マイナーバージョンのバージョンアップのタイミングを制御できること

### 仕様

バージョニング処理用の Github Action の仕様は以下の通りです。
- PR マージ操作またはpush 操作により main リポジトリが更新されると発火する
- コミットログ内容より適切な「次のバージョン番号」を導出する
- その番号を利用して、package.json の更新（ある場合）および git のタグ付けを行い、commit + push する

#### バージョン番号導出仕様

- コミットログ内に ```\\[[MAJOR]]``` が含まれている場合、メジャーバージョンのアップデートを行う
- コミットログ内に ```\\[[MINOR]]``` が含まれている場合、マイナーバージョンのアップデートを行う
- 上記以外の場合、パッチバージョンのアップデートを行う。ただし、本 Github Action による push の場合は バージョンアップしない

### 仕様 (RC 版)

プレリリースバージョン用のバージョニングを利用して、RC 版を各種パッケージ管理サービスに登録できるようにします。プレリリースバージョニング処理用の Github Action の仕様は以下の通りです。
- main 以外のリポジトリがpushされ、かつ、コミットログに  ```\\[[PRERELEASE]]``` が含まれている場合に発火する
- バージョン番号を、ブランチ名の sha256 ハッシュの先頭８文字を使用して、 ```0.1.1-rc${ハッシュ}.0``` の形式で設定する。同ブランチ内での２回目以降のリリース処理では、プレリリースバージョンをインクリメントする
--　例（このブランチで１回目のプレリリース）：元のバージョン：```0.0.22``` → 更新後のバージョン ```0.0.23-rcd816511d.0```
--　例（このブランチで２回目のプレリリース）：元のバージョン：```0.0.23-rcd816511d.0``` → 更新後のバージョン ```0.0.23-rcd816511d.1```
- その番号を利用して、package.json の更新（ある場合）および git のタグ付けを行い、commit + push する

### 仕様 (旧互換 Stableブランチ)

メジャーまたはマイナーバージョンアップデート以後、必要に応じて、旧互換対応としてのStable ブランチを作成できます。旧互換処理用の Github Action の仕様は以下の通りです。
- Stable-ではじまるリポジトリがpushされた場合に発火する
- パッチバージョンのアップデートを行う。
- その番号を利用して、package.json の更新（ある場合）および git のタグ付けを行い、commit + push する

### 仕様 (旧互換 ・パッチブランチ)

旧互換対応のうち、リリースミスや案件特殊事情等により、Stable ブランチの最新を使用できず、それ以前のコミットからのパッチ適用が必要となる場合が考えられます。
このパターンについては、上述の RC 版と同じ手順で、基点バージョンからのプレリリース番号付与で対応することとします。
 
### 実装

Github Action の定義を以下に示します。
 [[本リリース用:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/version.yml]] 
 [[RCリリース用:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/rc-version.yml]] 

バージョンアップ処理およびgit のタグ付け、commit、push はいずれも  [[release-it:https://github.com/release-it/release-it]] を利用しています。
この定義では、↑に記載した発火条件や処理内容をもとに、release-it のコマンドラインを調整しています。release-it の設定ファイルは  [[本リリース用設定:https://github.com/kkuwa/my-automatebuild-test/blob/main/.release-it.json]]  と  [[RCリリース用設定:https://github.com/kkuwa/my-automatebuild-test/blob/main/.release-it-prerelease.json]] です

## リリース管理

### 目標

- ↑の Github Action によるタグ発生時に、主要パッケージ管理サービス（dockerhub, npm, dockerhub, ....）への登録が実行されること
- RC 版リリースの場合もパッケージ管理サービスに登録できること、また、通常の利用者が意図せずRC版を利用してしまわないこと

### 各パッケージ管理サービスで共通の仕様

- タグが push されたときに発火する
-- タグの書式が ```'v[0-9].[0-9]+.[0-9]+'``` の場合、正式版リリース処理を実行する
-- タグの書式が ```'v[0-9]+.[0-9]+.[0-9]+-[a-f0-9]+.[0-9]+'``` の場合、RC版リリース処理を実行する
※タグ付けは前述の「バージョニング」の Github Action によって実行される。開発者がバージョン番号を手動で実行することはない

### dockerhub 連携仕様

- 正式版で、かつ、タグが最新の場合、ビルド成果物を、 latest とメジャー、マイナー、パッチまでの各バージョンでタグ付けする
-- 例：git のタグが```v1.2.3``` の場合、```1```、```1.2```、```1.2.3```、```latest```の４つのタグがつけられる
- 正式版で、かつ、タグが最新でない場合（Stableブランチのタグ）、ビルド成果物を、 マイナー、パッチまでの各バージョンでタグ付けする
-- 例：git のタグが```v1.2.3``` の場合、```1.2```、```1.2.3``` の２つのタグがつけられる
- RC 版の場合、ビルド成果物を、プレリリースバージョンでタグ付けする
-- 例：git のタグが```v0.0.23-rcd816511d.0``` の場合、```0.0.23-rcd816511d.0```の１種類がこのイメージに紐づけられる。latest は更新されず、また```0.0.23-rcd816511d```のようなタグも付けられないので、RCを利用するためにはビルドの都度、開発者が更新後のバージョンを確認したうえで、タグを完全一致で指定する必要がある
実装例： [[正式版:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/dockerhub.yml]] 、 [[RC版:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/rc-dockerhub.yml]] 

#### 注意事項

バージョン番号とビルド生成物の整合性の確保のために、Dockerfile では Github action 内で checkout したコード上を使用してビルドする必要がある。
※ Dockerfile 内で git clone 等を実行してソースをダウンロードしてしまうと、発火した際のソースとビルド生成物の整合性が取れなくなる可能性がある

### npm 連携仕様

- バージョニングの Github Action により、package.json 内のバージョン番号が更新されたものがタグ付けされているはずであるため、正式版、RC版ともに、単に build ~ publishを実行する
- 正式版で、かつタグが最新でない場合（Stableブランチのタグ）、publish 時に ```--tag stable-${major}.${minor} ``` オプションを指定する。
- RC版の場合、publish 時に ```--tag prerelease``` オプションを指定する。これにより、同バージョンのインストールには```npm i @chip-in/resource-node:prerelease``` （これは別のブランチの成果物が出てくる可能性があり推奨されない）または ```npm i @chip-in/resource-node@0.0.23-d816511d.1``` が必要になり、利用者が```npm i @chip-in/resource-node``` としてもRC版はインストールされない。
実装例： [[正式版:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/npm.yml]] 、 [[RC版:https://github.com/kkuwa/my-automatebuild-test/blob/main/.github/workflows/rc-npm.yml]]

### github 連携仕様

github の Releases 以下にビルド成果物（RPM等）を配置する処理が該当します。
- 各パッケージの成果物生成後、github にリリースする。この時、すでにバージョニングの Github Action によりタグが生成されているため、上書更新の設定が必要
- RC版の場合、prerelease フラグを有効にする。これにより、github の リリース画面の該当バージョンには「pre-release」のバッチ付きで表示されるようになる

#### 注意事項

バージョン番号とビルド生成物の整合性の確保のために、成果物生成処理 では Github action 内で checkout したコード上を使用してビルドする必要がある。
※ 生成処理で git clone 等を実行してソースをダウンロードしてしまうと、発火した際のソースとビルド生成物の整合性が取れなくなる可能性がある
