# 🍚 ごはんサーチ (eat)

場所（例:「名古屋駅」）を入力するか現在地を使うと、周辺の飲食店を
**和食・洋食・中華…のジャンル別**に分けて、**評価・口コミ数**付きで一覧表示する Web アプリです。

- 地名検索 / 📍 現在地（ブラウザの位置情報）
- 検索範囲: 500m / 1km / 2km / 3km
- ジャンル: 和食 / 洋食 / 中華 / 焼肉・韓国料理 / アジア・エスニック / 居酒屋・バー / カフェ・スイーツ
- 並び替え: おすすめ順（口コミ数で補正した評価）/ 評価順 / 口コミ数順 / 近い順
- 絞り込み: 最低評価、営業中のみ
- 各店舗に「Googleマップ」「食べログで探す」リンク
- `?q=名古屋駅` 付きの URL を開くとそのまま検索（共有用）

## データの取得元について

| サービス | 使い方 |
| --- | --- |
| **Google マップ** | 公式の [Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview) で店舗・評価・口コミ数・営業状況を取得 |
| **食べログ** | 公開 API がなく、利用規約でスクレイピング等の機械的な取得が禁止されているため、データは取得していません。各店舗に「食べログで探す」リンク（食べログ内を店名＋住所で検索）を付けています |

## 使い方

Node.js 20.12 以上が必要です。外部パッケージは使っていません。

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

### 料金と使いすぎ防止

1 回の検索で Google Places API を最大 8 回呼びます（地名→座標の変換 1 回 + ジャンルごとの周辺検索 7 回）。
同じ地点・範囲の検索結果はサーバーで 10 分間キャッシュし、その分は呼び出しません。

Places API には料金区分ごとに毎月の無料枠があります。このアプリは呼び出し回数を数えて、
**月間上限に届く検索は Google を呼ぶ前に止めます**（画面に「上限に達したため検索を止めています」と表示）。

| 料金区分 | このアプリでの用途 | 上限の設定 | 既定値 |
| --- | --- | --- | --- |
| Text Search Pro | 地名 → 座標 | `MONTHLY_LIMIT_TEXT` | 5000 |
| Nearby Search Enterprise | 評価付きの周辺検索 | `MONTHLY_LIMIT_NEARBY` | 1000 |

既定値は無料枠の回数です（周辺検索 1000 回 ÷ 7 ≒ 月 140 検索）。無料枠は変わることがあるので
[料金ページ](https://developers.google.com/maps/billing-and-pricing/pricing) で確認し、必要なら `.env` で変えてください。

- 回数は `data/usage.json` に保存され、再起動しても引き継がれます（`USAGE_FILE` で場所を変更可）
- Google の請求月に合わせて、太平洋時間の月初（日本時間で 1 日の 16 時か 17 時）にリセットされます
- 今月の利用回数は画面下部に表示されます（8 割を超えると赤字）
- サーバー 1 台で動かす前提です。複数台で動かすと台ごとに数えてしまいます
- 念のため、Cloud Console の「割り当て」でも 1 日あたりの上限を設定しておくと二重の安全策になります

### 現在地について

ブラウザの位置情報は `https://` か `http://localhost` でしか使えません。

## 開発

```sh
npm run dev   # ファイル変更で自動再起動
npm test      # テスト (node:test)
```

```
server.js            HTTP サーバー (/api/search と静的ファイル)
lib/categories.js    ジャンル定義と Google の店舗タイプ → ジャンルの振り分け
lib/places.js        Google Places API (New) の呼び出しと結果の整形
lib/usage.js         API 呼び出し回数の記録と月間上限
lib/demo.js          デモ用の架空データ
public/              画面 (HTML / CSS / JS)
test/                テスト
```

### API

`GET /api/search?q=名古屋駅&radius=1000` または `GET /api/search?lat=35.17&lng=136.88&radius=1000`

月間上限に達していると `429` と `{ "error": "…", "usage": … }` を返します。
今月の利用回数だけを見るときは `GET /api/usage` を使います。

```jsonc
{
  "demo": false,
  "center": { "name": "名古屋駅", "address": "…", "lat": 35.17, "lng": 136.88 },
  "radius": 1000,
  "categories": [
    {
      "id": "washoku", "label": "和食", "emoji": "🍣",
      "restaurants": [
        {
          "id": "…", "name": "…", "genre": "寿司店",
          "rating": 4.3, "reviewCount": 812,
          "priceLevel": 2, "priceRange": "¥1,000〜¥2,000",
          "distance": 350, "openNow": true, "address": "…",
          "mapsUrl": "https://maps.google.com/…", "tabelogUrl": "https://www.google.com/search?q=site%3Atabelog.com…"
        }
      ]
    }
  ]
}
```

ジャンルの分け方は `lib/categories.js` の `CATEGORIES` を編集すると変えられます。
