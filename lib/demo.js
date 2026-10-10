// API キーがないときに使う架空のデータ。実在の店舗ではない。
import { CATEGORIES } from './categories.js';
import { groupPlaces } from './places.js';

const KNOWN_PLACES = {
  名古屋駅: { lat: 35.170915, lng: 136.881537, address: '愛知県名古屋市中村区名駅1丁目' },
  栄: { lat: 35.168689, lng: 136.908457, address: '愛知県名古屋市中区栄' },
  東京駅: { lat: 35.681236, lng: 139.767125, address: '東京都千代田区丸の内1丁目' },
  渋谷駅: { lat: 35.658034, lng: 139.701636, address: '東京都渋谷区道玄坂1丁目' },
  新宿駅: { lat: 35.689634, lng: 139.700565, address: '東京都新宿区新宿3丁目' },
  大阪駅: { lat: 34.702485, lng: 135.495951, address: '大阪府大阪市北区梅田3丁目' },
  京都駅: { lat: 34.985849, lng: 135.758767, address: '京都府京都市下京区東塩小路町' },
  博多駅: { lat: 33.589728, lng: 130.420727, address: '福岡県福岡市博多区博多駅中央街' },
  札幌駅: { lat: 43.068661, lng: 141.350755, address: '北海道札幌市北区北6条西4丁目' },
};

const NAMES = {
  washoku: [
    ['和食処 さくら', 'japanese_restaurant', '和食店'],
    ['鮨 まるやま', 'sushi_restaurant', '寿司店'],
    ['らーめん 一番星', 'ramen_restaurant', 'ラーメン店'],
    ['ひつまぶし 川瀬', 'japanese_restaurant', '和食店'],
    ['味噌煮込み 木曽屋', 'japanese_restaurant', '和食店'],
    ['手打ちそば 竹林', 'japanese_restaurant', '和食店'],
    ['天ぷら 天満', 'japanese_restaurant', '和食店'],
  ],
  yoshoku: [
    ['トラットリア ソーレ', 'italian_restaurant', 'イタリア料理店'],
    ['ビストロ ル・シエル', 'french_restaurant', 'フランス料理店'],
    ['洋食屋 グリル松本', 'american_restaurant', 'アメリカ料理店'],
    ['ステーキハウス 炎', 'steak_house', 'ステーキハウス'],
    ['ナポリピッツァ ルーチェ', 'pizza_restaurant', 'ピザ店'],
    ['バーガースタンド BB', 'hamburger_restaurant', 'ハンバーガー店'],
  ],
  chuka: [
    ['中華料理 龍門', 'chinese_restaurant', '中華料理店'],
    ['小籠包 点心坊', 'chinese_restaurant', '中華料理店'],
    ['四川飯店 麻辣', 'chinese_restaurant', '中華料理店'],
    ['町中華 福来', 'chinese_restaurant', '中華料理店'],
  ],
  yakiniku: [
    ['焼肉 牛若', 'barbecue_restaurant', '焼肉店'],
    ['韓国料理 ソウル食堂', 'korean_restaurant', '韓国料理店'],
    ['ホルモン ぶんぶん', 'barbecue_restaurant', '焼肉店'],
  ],
  ethnic: [
    ['タイ食堂 バーンタイ', 'thai_restaurant', 'タイ料理店'],
    ['インドカレー ガネーシャ', 'indian_restaurant', 'インド料理店'],
    ['フォー専門店 サイゴン', 'vietnamese_restaurant', 'ベトナム料理店'],
  ],
  izakaya: [
    ['大衆酒場 とり平', 'bar', 'バー'],
    ['手羽先 鳥友', 'bar', 'バー'],
    ['ワインバル ヴィーノ', 'wine_bar', 'ワインバー'],
    ['英国風パブ クラウン', 'pub', 'パブ'],
  ],
  cafe: [
    ['喫茶 まつば', 'coffee_shop', 'コーヒーショップ'],
    ['カフェ ひだまり', 'cafe', 'カフェ'],
    ['パティスリー ミエル', 'dessert_shop', 'デザートショップ'],
    ['ベーカリー 小麦の森', 'bakery', 'ベーカリー'],
    ['甘味処 あずき', 'tea_house', '茶屋'],
  ],
};

// 同じ地点なら毎回同じ結果になるよう、座標から決まる擬似乱数を使う
function seededRandom(seed) {
  let s = Math.floor(Math.abs(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function demoGeocode(query) {
  const key = Object.keys(KNOWN_PLACES).find((k) => query.includes(k) || k.includes(query));
  const base = key ? KNOWN_PLACES[key] : KNOWN_PLACES['名古屋駅'];
  return { name: key ?? query, address: base.address, lat: base.lat, lng: base.lng };
}

export function demoSearch({ lat, lng, radius }) {
  const rand = seededRandom(lat * 1e5 + lng * 1e3 + radius);
  const levels = [
    'PRICE_LEVEL_INEXPENSIVE',
    'PRICE_LEVEL_MODERATE',
    'PRICE_LEVEL_EXPENSIVE',
  ];
  const results = CATEGORIES.map((category) => ({
    categoryId: category.id,
    places: NAMES[category.id].map(([name, type, typeLabel], i) => {
      const angle = rand() * 2 * Math.PI;
      const dist = rand() * radius;
      const dLat = (dist * Math.cos(angle)) / 111320;
      const dLng = (dist * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
      const hasRating = rand() > 0.08;
      return {
        id: `demo-${category.id}-${i}`,
        displayName: { text: `【デモ】${name}` },
        primaryType: type,
        primaryTypeDisplayName: { text: typeLabel },
        types: [type, 'restaurant'],
        rating: hasRating ? Math.round((3.2 + rand() * 1.7) * 10) / 10 : undefined,
        userRatingCount: hasRating ? Math.floor(rand() ** 2 * 2500) + 3 : undefined,
        priceLevel: levels[Math.floor(rand() * levels.length)],
        shortFormattedAddress: '架空の住所',
        location: { latitude: lat + dLat, longitude: lng + dLng },
        currentOpeningHours: { openNow: rand() > 0.3 },
        businessStatus: 'OPERATIONAL',
      };
    }),
  }));
  const categories = groupPlaces(results, { lat, lng });
  for (const category of categories) {
    for (const r of category.restaurants) r.tabelogUrl = 'https://tabelog.com/';
  }
  return categories;
}
