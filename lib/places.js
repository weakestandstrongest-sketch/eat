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

async function post(path, body, fieldMask, apiKey) {
  const res = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PlacesError(json.error?.message ?? `Places API HTTP ${res.status}`, res.status);
  }
  return json;
}

// 「名古屋駅」のような地名を緯度経度に変換する。見つからなければ null。
export async function geocode(query, apiKey) {
  const json = await post(
    'places:searchText',
    { textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 1 },
    GEOCODE_FIELDS,
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
export async function searchRestaurants({ lat, lng, radius }, apiKey) {
  const settled = await Promise.allSettled(
    CATEGORIES.map(async (category) => {
      const json = await post(
        'places:searchNearby',
        {
          includedTypes: category.types,
          maxResultCount: 20,
          rankPreference: 'POPULARITY',
          languageCode: 'ja',
          regionCode: 'JP',
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lng }, radius },
          },
        },
        NEARBY_FIELDS,
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
    distance: place.location
      ? Math.round(distanceMeters(center, { lat: place.location.latitude, lng: place.location.longitude }))
      : null,
    mapsUrl: place.googleMapsUri ?? null,
    tabelogUrl: tabelogSearchUrl(name, address),
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
