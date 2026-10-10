import { CATEGORIES, classify } from './categories.js';

const API_BASE = 'https://places.googleapis.com/v1';

const GEOCODE_FIELDS = [
  'places.displayName',
  'places.formattedAddress',
  'places.location',
].join(',');

const NEARBY_FIELDS = [
  'places.id',
  'places.displayName',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.types',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.priceRange',
  'places.shortFormattedAddress',
  'places.formattedAddress',
  'places.location',
  'places.googleMapsUri',
  'places.currentOpeningHours.openNow',
  'places.businessStatus',
].join(',');

const PRICE_LEVELS = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

export class PlacesError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const DETAIL_FIELDS = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'rating',
  'userRatingCount',
  'googleMapsUri',
  'websiteUri',
  'nationalPhoneNumber',
  'regularOpeningHours.weekdayDescriptions',
  'currentOpeningHours.openNow',
  'priceRange',
  'editorialSummary',
  'reviews',
  'photos',
  'takeout',
  'delivery',
  'dineIn',
  'reservable',
  'servesBreakfast',
  'servesLunch',
  'servesDinner',
  'servesBeer',
  'servesWine',
  'servesVegetarianFood',
  'outdoorSeating',
  'goodForChildren',
  'goodForGroups',
  'allowsDogs',
  'paymentOptions',
].join(',');

// 詳細画面で表示する写真の最大枚数 (1 枚ごとに Place Photo の料金がかかる)
export const MAX_PHOTOS = 3;

const FEATURES = [
  ['reservable', '予約可'],
  ['takeout', 'テイクアウト'],
  ['delivery', 'デリバリー'],
  ['dineIn', '店内飲食'],
  ['servesBreakfast', '朝食'],
  ['servesLunch', 'ランチ'],
  ['servesDinner', 'ディナー'],
  ['servesBeer', 'ビール'],
  ['servesWine', 'ワイン'],
  ['servesVegetarianFood', 'ベジタリアン対応'],
  ['outdoorSeating', 'テラス席'],
  ['goodForChildren', '子ども連れ歓迎'],
  ['goodForGroups', '団体向け'],
  ['allowsDogs', 'ペット可'],
];

async function request(path, { body, fieldMask, query } = {}, apiKey) {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const headers = { 'X-Goog-Api-Key': apiKey };
  if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlacesError(json.error?.message ?? `Places API HTTP ${res.status}`, res.status);
  }
  return json;
}

// 「名古屋駅」のような地名を緯度経度に変換する。見つからなければ null。
export async function geocode(query, apiKey) {
  const json = await request(
    'places:searchText',
    {
      body: { textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 1 },
      fieldMask: GEOCODE_FIELDS,
    },
    apiKey,
  );
  const place = json.places?.[0];
  if (!place?.location) return null;
  return {
    name: place.displayName?.text ?? query,
    address: place.formattedAddress ?? '',
    lat: place.location.latitude,
    lng: place.location.longitude,
  };
}

// ジャンルごとに Nearby Search を投げ (1 ジャンル最大 20 件)、重複を除いてまとめる。
// rank が 'distance' なら近い店から、それ以外は人気の店から 20 件を取る。
export async function searchRestaurants({ lat, lng, radius, rank = 'popularity' }, apiKey) {
  const settled = await Promise.allSettled(
    CATEGORIES.map(async (category) => {
      const json = await request(
        'places:searchNearby',
        {
          body: {
            includedTypes: category.types,
            maxResultCount: 20,
            rankPreference: rank === 'distance' ? 'DISTANCE' : 'POPULARITY',
            languageCode: 'ja',
            regionCode: 'JP',
            locationRestriction: {
              circle: { center: { latitude: lat, longitude: lng }, radius },
            },
          },
          fieldMask: NEARBY_FIELDS,
        },
        apiKey,
      );
      return { categoryId: category.id, places: json.places ?? [] };
    }),
  );

  const fulfilled = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (fulfilled.length === 0) throw settled[0].reason;
  return groupPlaces(fulfilled, { lat, lng });
}

// 検索結果 [{ categoryId, places }] を店舗単位で重複排除し、ジャンル別に並べ直す。
export function groupPlaces(results, center) {
  const byId = new Map();
  for (const { categoryId, places } of results) {
    for (const place of places) {
      if (byId.has(place.id)) continue;
      if (place.businessStatus && place.businessStatus !== 'OPERATIONAL') continue;
      byId.set(place.id, normalize(place, classify(place, categoryId), center));
    }
  }
  const restaurants = [...byId.values()];
  return CATEGORIES.map(({ id, label, emoji }) => ({
    id,
    label,
    emoji,
    restaurants: restaurants.filter((r) => r.category === id),
  }));
}

export function normalize(place, category, center) {
  const name = place.displayName?.text ?? '(名称不明)';
  const address = place.shortFormattedAddress ?? place.formattedAddress ?? '';
  return {
    id: place.id,
    name,
    category,
    genre: place.primaryTypeDisplayName?.text ?? '',
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? 0,
    priceLevel: PRICE_LEVELS[place.priceLevel] ?? null,
    priceRange: formatPriceRange(place.priceRange),
    address,
    openNow: place.currentOpeningHours?.openNow ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    distance: place.location
      ? Math.round(distanceMeters(center, { lat: place.location.latitude, lng: place.location.longitude }))
      : null,
    mapsUrl: place.googleMapsUri ?? null,
    tabelogUrl: tabelogSearchUrl(name, address),
    hotpepperUrl: hotpepperSearchUrl(name, address),
  };
}

// 店舗の詳細 (営業時間・口コミ・写真など) を取る。
// reservePhotos(n) は写真を何枚取ってよいかを返す (使いすぎ防止用)。
export async function getPlaceDetails(id, apiKey, { reservePhotos = (n) => n } = {}) {
  const place = await request(
    `places/${id}`,
    { fieldMask: DETAIL_FIELDS, query: { languageCode: 'ja', regionCode: 'JP' } },
    apiKey,
  );
  const wanted = (place.photos ?? []).slice(0, MAX_PHOTOS);
  const allowed = wanted.slice(0, reservePhotos(wanted.length));
  const photos = await Promise.allSettled(
    allowed.map(async (photo) => {
      const media = await request(
        `${photo.name}/media`,
        { query: { maxWidthPx: 800, skipHttpRedirect: 'true' } },
        apiKey,
      );
      const author = photo.authorAttributions?.[0];
      return { url: media.photoUri, author: author?.displayName ?? '', authorUri: author?.uri ?? null };
    }),
  );
  return normalizeDetails(
    place,
    photos.filter((r) => r.status === 'fulfilled').map((r) => r.value),
  );
}

export function normalizeDetails(place, photos = []) {
  const name = place.displayName?.text ?? '(名称不明)';
  const address = place.formattedAddress ?? '';
  const features = FEATURES.filter(([field]) => place[field] === true).map(([, label]) => label);
  if (place.paymentOptions?.acceptsCreditCards) features.push('クレジットカード可');
  if (place.paymentOptions?.acceptsCashOnly) features.push('現金のみ');
  return {
    id: place.id,
    name,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? 0,
    address,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    openNow: place.currentOpeningHours?.openNow ?? null,
    hours: place.regularOpeningHours?.weekdayDescriptions ?? [],
    priceRange: formatPriceRange(place.priceRange),
    summary: place.editorialSummary?.text ?? null,
    features,
    photos,
    reviews: (place.reviews ?? []).map((review) => ({
      author: review.authorAttribution?.displayName ?? '匿名',
      authorUri: review.authorAttribution?.uri ?? null,
      rating: review.rating ?? null,
      text: review.text?.text ?? review.originalText?.text ?? '',
      time: review.relativePublishTimeDescription ?? '',
    })),
    tabelogUrl: tabelogSearchUrl(name, address),
    hotpepperUrl: hotpepperSearchUrl(name, address),
  };
}

function formatPriceRange(range) {
  const start = range?.startPrice?.units;
  const end = range?.endPrice?.units;
  if (!start && !end) return null;
  const yen = (units) => `¥${Number(units).toLocaleString('ja-JP')}`;
  if (start && end) return `${yen(start)}〜${yen(end)}`;
  return start ? `${yen(start)}〜` : `〜${yen(end)}`;
}

// 食べログには公開 API がなくスクレイピングも規約で禁止されているため、
// 店名と住所で食べログ内を検索するリンクを付ける。
export function tabelogSearchUrl(name, address = '') {
  const q = `site:tabelog.com ${name} ${address}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

// ホットペッパーグルメ API は評価を返さないため、食べログと同じく検索リンクにする。
export function hotpepperSearchUrl(name, address = '') {
  const q = `site:hotpepper.jp ${name} ${address}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
