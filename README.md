# 🍚 ごはんサーチ (eat)

場所（例:「名古屋駅」）を入力するか現在地を使うと、周辺の飲食店を
**和食・洋食・中華…のジャンル別**に分けて、**評価・口コミ数**付きで一覧表示する Web アプリです。

- 地名検索 / 📍 現在地（ブラウザの位置情報）
- 検索範囲: 500m / 1km / 2km / 3km
- 集め方: 人気の店から / 近い店から（各ジャンル最大 20 件）
- ジャンル: 和食 / 洋食 / 中華 / 焼肉・韓国料理 / アジア・エスニック / 居酒屋・バー / カフェ・スイーツ
- 並び替え: おすすめ順（口コミ数で補正した評価）/ 評価順 / 口コミ数順 / 近い順
- 絞り込み: 最低評価、営業中のみ
- 距離は「徒歩約◯分（◯m）」で表示（直線距離を 80m = 1 分で換算）
- お店を押すと詳細画面: 写真、営業時間、電話、予算、設備（予約可・テイクアウトなど）、Google の口コミ、
  出発地（検索地点 / 現在地）とお店の場所を示した地図、Googleマップの徒歩ルートへのリンク
- 各店舗に「Googleマップ」「食べログで探す」「ホットペッパーで探す」リンク
- `?q=名古屋駅` 付きの URL を開くとそのまま検索（共有用）

## データの取得元について

| サービス | 使い方 |
| --- | --- |
| **Google マップ** | 公式の [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview) で店舗・評価・口コミ数・営業状況を取得 |
| **食べログ** | 公開 API がなく、利用規約でスクレイピング等の機械的な取得が禁止されているため、データは取得していません。各店舗に「食べログで探す」リンク（食べログ内を店名＋住所で検索）を付けています |
| **ホットペッパーグルメ** | 公式 API はありますが評価・口コミを返さないため使っていません。「ホットペッパーで探す」リンクを付けています |
| **地図** | Maps Embed API のキーがあれば Google マップの徒歩ルート、なければ [Leaflet](https://leafletjs.com/) + OpenStreetMap で出発地とお店を表示 |

## 使い方

Node.js 20.12 以上が必要です。PC で動かすだけなら `npm install` は不要です（外部パッケージを使っていません）。

```sh
npm start          # http://localhost:3000
```

API キーがなければ **デモモード**（架空の店舗データ）で動きます。

### 実データで動かす

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作り、課金を有効にする
2. 「Places API (New)」を有効にする
3. API キーを作成し、利用できる API を Places API (New) に制限する
4. `.env.example` を `.env` にコピーしてキーを書く

   ```sh
   cp .env.example .env
   # GOOGLE_MAPS_API_KEY=xxxxxxxx
   ```

5. `npm start`

API キーはサーバー側だけで使い、ブラウザには渡しません。

#### 詳細画面の地図を Google マップにする（任意・無料）

[Maps Embed API](https://developers.google.com/maps/documentation/embed/get-started) は無料で回数制限もありません。
このキーはブラウザに渡るので、上のキーとは**別に**作ってください。

1. Cloud Console で「Maps Embed API」を有効にする
2. 新しい API キーを作り、「API の制限」を Maps Embed API のみ、「アプリケーションの制限」を
   HTTP リファラー（例: `http://localhost:3000/*` や公開する URL）にする
3. `.env` に `GOOGLE_MAPS_EMBED_KEY=...` を書く

設定しない場合は OpenStreetMap の地図に出発地とお店を表示します（「Googleマップで道順を見る」リンクはどちらでも使えます）。

### 料金と使いすぎ防止

1 回の検索で Google Places API を最大 8 回呼びます（地名→座標の変換 1 回 + ジャンルごとの周辺検索 7 回）。
「集め方」を切り替えると取り直すので、もう 7 回呼びます。
お店の詳細画面を開くと 1 回 + 写真の枚数分（最大 3 枚）を呼びます。
同じ検索・同じお店はサーバーで 10 分間キャッシュし、その分は呼び出しません。

Places API には料金区分ごとに毎月の無料枠があります。このアプリは呼び出し回数を数えて、
**月間上限に届く検索は Google を呼ぶ前に止めます**（画面に「上限に達したため検索を止めています」と表示）。

| 料金区分 | このアプリでの用途 | 上限の設定 | 既定値 |
| --- | --- | --- | --- |
| Text Search Pro | 地名 → 座標 | `MONTHLY_LIMIT_TEXT` | 5000 |
| Nearby Search Enterprise | 評価付きの周辺検索 | `MONTHLY_LIMIT_NEARBY` | 1000 |
| Place Details Enterprise + Atmosphere | 詳細画面（口コミ・営業時間など） | `MONTHLY_LIMIT_DETAILS` | 1000 |
| Place Details Photos | 詳細画面の写真 | `MONTHLY_LIMIT_PHOTO` | 1000 |

既定値は無料枠の回数です（周辺検索 1000 回 ÷ 7 ≒ 月 140 検索、詳細は月 1000 店）。
写真の枠がなくなっても、詳細画面は写真なしで表示します。無料枠は変わることがあるので
[料金ページ](https://developers.google.com/maps/billing-and-pricing/pricing) で確認し、必要なら `.env` で変えてください。

- 回数は `data/usage.json` に保存され、再起動しても引き継がれます（`USAGE_FILE` で場所を変更可）
- Google の請求月に合わせて、太平洋時間の月初（日本時間で 1 日の 16 時か 17 時）にリセットされます
- 今月の利用回数は画面下部に表示されます（8 割を超えると赤字）
- サーバー 1 台で動かす前提です。複数台で動かすと台ごとに数えてしまいます
- 念のため、Cloud Console の「割り当て」でも 1 日あたりの上限を設定しておくと二重の安全策になります

### 現在地について

ブラウザの位置情報は `https://` か `http://localhost` でしか使えません。

## iPhone で外から使う（Cloudflare Workers に置く）

アプリを [Cloudflare Workers](https://workers.cloudflare.com/)（無料プラン）に置くと、
`https://eat.〇〇.workers.dev` の URL で、PC の電源を切っていてもどこからでも使えます。

**準備**: 上の「実データで動かす」を済ませ、`.env` に `GOOGLE_MAPS_API_KEY` が書かれていること。

1. https://dash.cloudflare.com/sign-up で Cloudflare のアカウントを作る（無料・カード不要）
2. アプリのフォルダで次を実行する

   ```sh
   npm run deploy
   ```

   - 初回はアプリを開くときの**パスワード**を聞かれます（8 文字以上。`.env` の `APP_PASSWORD` に保存されます）
   - ブラウザが開いたら Cloudflare にログインして「Allow」を押します
   - `workers.dev` のサブドメイン（URL の〇〇の部分）を聞かれたら、好きな英数字を入れます
3. 最後に表示される `https://eat.〇〇.workers.dev` を iPhone の Safari で開き、パスワードを入れる
4. 共有ボタン →「ホーム画面に追加」でアイコンにする

アプリを直したときや `.env` を変えたときは、もう一度 `npm run deploy` を実行すると反映されます。

- URL を知っている人でも、パスワードを知らなければ API を使えません（Google の無料枠を他人に使われないため）
- 使用回数は Cloudflare の Durable Object に保存され、月間上限もそのまま効きます。
  PC 版（`data/usage.json`）とは別に数えるので、両方で使うと合計が上限を超えることがあります
- Maps Embed API のキーを使う場合は、HTTP リファラー制限に `https://eat.〇〇.workers.dev/*` を追加してください
- Cloudflare 上の動きを PC で試すときは `npm run dev:worker`（`npm install` が必要）

## 開発

```sh
npm run dev   # ファイル変更で自動再起動
npm test      # テスト (node:test)
```

```
server.js            PC 用の HTTP サーバー (/api/* は lib/app.js、画面は public/)
worker.js            Cloudflare Workers 用の入口と、回数を保存する Durable Object
wrangler.jsonc       Cloudflare Workers の設定
scripts/deploy.js    npm run deploy の中身 (ログイン・アップロード・キーの登録)
lib/app.js           /api/* と /login の処理 (PC と Cloudflare で共通)
lib/categories.js    ジャンル定義と Google の店舗タイプ → ジャンルの振り分け
lib/places.js        Google Places API (New) の呼び出しと結果の整形
lib/usage.js         API 呼び出し回数の記録と月間上限
lib/usage-file.js    PC 版の回数の保存先 (data/usage.json)
lib/demo.js          デモ用の架空データ
public/              画面 (HTML / CSS / JS / アイコン / manifest)
test/                テスト
```

### API

| エンドポイント | 内容 |
| --- | --- |
| `GET /api/search?q=名古屋駅&radius=1000&rank=popularity` | 地名で検索（`rank=distance` で近い店から） |
| `GET /api/search?lat=35.17&lng=136.88&radius=1000` | 緯度経度（現在地）で検索 |
| `GET /api/place?id=<店舗ID>` | お店の詳細（写真・営業時間・口コミなど） |
| `GET /api/config` | デモモードか、Embed 用キー、今月の利用回数 |
| `GET /login` / `POST /login` | ログイン画面 / パスワードを確かめて Cookie を発行（パスワード設定時のみ） |

月間上限に達していると `429` と `{ "error": "…", "usage": … }` を返します。
パスワードを設定していてログインしていないと `401` を返し、画面はログイン画面に移ります。

`/api/search` の結果:

```jsonc
{
  "demo": false,
  "center": { "name": "名古屋駅", "address": "…", "lat": 35.17, "lng": 136.88 },
  "radius": 1000,
  "rank": "popularity",
  "categories": [
    {
      "id": "washoku", "label": "和食", "emoji": "🍣",
      "restaurants": [
        {
          "id": "…", "name": "…", "genre": "寿司店",
          "rating": 4.3, "reviewCount": 812,
          "priceLevel": 2, "priceRange": "¥1,000〜¥2,000",
          "lat": 35.171, "lng": 136.882, "distance": 350, "openNow": true, "address": "…",
          "mapsUrl": "https://maps.google.com/…",
          "tabelogUrl": "https://www.google.com/search?q=site%3Atabelog.com…",
          "hotpepperUrl": "https://www.google.com/search?q=site%3Ahotpepper.jp…"
        }
      ]
    }
  ]
}
```

ジャンルの分け方は `lib/categories.js` の `CATEGORIES` を編集すると変えられます。
