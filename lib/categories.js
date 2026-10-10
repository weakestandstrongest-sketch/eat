// ジャンル分け定義。types は Google Places API (New) の Place Types (Table A)。
// https://developers.google.com/maps/documentation/places/web-service/place-types
export const CATEGORIES = [
  {
    id: 'washoku',
    label: '和食',
    emoji: '🍣',
    types: ['japanese_restaurant', 'sushi_restaurant', 'ramen_restaurant'],
  },
  {
    id: 'yoshoku',
    label: '洋食',
    emoji: '🍝',
    types: [
      'italian_restaurant',
      'french_restaurant',
      'american_restaurant',
      'steak_house',
      'hamburger_restaurant',
      'pizza_restaurant',
      'spanish_restaurant',
      'mediterranean_restaurant',
      'greek_restaurant',
    ],
  },
  {
    id: 'chuka',
    label: '中華',
    emoji: '🥟',
    types: ['chinese_restaurant'],
  },
  {
    id: 'yakiniku',
    label: '焼肉・韓国料理',
    emoji: '🥩',
    types: ['korean_restaurant', 'barbecue_restaurant'],
  },
  {
    id: 'ethnic',
    label: 'アジア・エスニック',
    emoji: '🍛',
    types: [
      'thai_restaurant',
      'vietnamese_restaurant',
      'indian_restaurant',
      'indonesian_restaurant',
      'asian_restaurant',
      'middle_eastern_restaurant',
      'turkish_restaurant',
      'lebanese_restaurant',
      'mexican_restaurant',
      'brazilian_restaurant',
    ],
  },
  {
    id: 'izakaya',
    label: '居酒屋・バー',
    emoji: '🍺',
    types: ['bar', 'pub', 'wine_bar', 'bar_and_grill'],
  },
  {
    id: 'cafe',
    label: 'カフェ・スイーツ',
    emoji: '☕',
    types: [
      'cafe',
      'coffee_shop',
      'bakery',
      'dessert_shop',
      'dessert_restaurant',
      'ice_cream_shop',
      'tea_house',
    ],
  },
];

const TYPE_TO_CATEGORY = new Map();
for (const category of CATEGORIES) {
  for (const type of category.types) {
    if (!TYPE_TO_CATEGORY.has(type)) TYPE_TO_CATEGORY.set(type, category.id);
  }
}

// 1 店舗を 1 ジャンルに振り分ける。
// primaryType を最優先し、なければ types を順に見て、それでも決まらなければ
// その店が見つかった検索のジャンル (fallbackId) にする。
export function classify(place, fallbackId) {
  const primary = TYPE_TO_CATEGORY.get(place.primaryType);
  if (primary) return primary;
  for (const type of place.types ?? []) {
    const id = TYPE_TO_CATEGORY.get(type);
    if (id) return id;
  }
  return fallbackId;
}
