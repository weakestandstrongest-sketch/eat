import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/categories.js';
import { distanceMeters, groupPlaces, normalize, searchRestaurants } from '../lib/places.js';

const NAGOYA = { lat: 35.170915, lng: 136.881537 };

test('classify は primaryType を最優先する', () => {
  assert.equal(classify({ primaryType: 'ramen_restaurant', types: ['bar'] }, 'izakaya'), 'washoku');
});

test('classify は primaryType が未知なら types を見る', () => {
  assert.equal(classify({ primaryType: 'izakaya_restaurant', types: ['bar', 'restaurant'] }, 'washoku'), 'izakaya');
});

test('classify は何も一致しなければ検索元ジャンルにする', () => {
  assert.equal(classify({ primaryType: 'restaurant', types: ['restaurant', 'food'] }, 'chuka'), 'chuka');
});

test('groupPlaces は重複と閉業店を除いてジャンル別に振り分ける', () => {
  const sushi = { id: 'a', displayName: { text: '寿司' }, primaryType: 'sushi_restaurant' };
  const closed = { id: 'b', displayName: { text: '閉店' }, primaryType: 'cafe', businessStatus: 'CLOSED_PERMANENTLY' };
  const groups = groupPlaces(
    [
      { categoryId: 'washoku', places: [sushi] },
      { categoryId: 'izakaya', places: [sushi, closed] },
    ],
    NAGOYA,
  );
  const ids = Object.fromEntries(groups.map((g) => [g.id, g.restaurants.map((r) => r.id)]));
  assert.deepEqual(ids.washoku, ['a']);
  assert.deepEqual(ids.izakaya, []);
  assert.deepEqual(ids.cafe, []);
});

test('normalize は評価・価格・距離を整形する', () => {
  const r = normalize(
    {
      id: 'x',
      displayName: { text: 'テスト食堂' },
      primaryTypeDisplayName: { text: '和食店' },
      rating: 4.2,
      userRatingCount: 321,
      priceLevel: 'PRICE_LEVEL_MODERATE',
      priceRange: { startPrice: { currencyCode: 'JPY', units: '1000' }, endPrice: { currencyCode: 'JPY', units: '2000' } },
      shortFormattedAddress: '名駅1丁目',
      location: { latitude: NAGOYA.lat + 0.001, longitude: NAGOYA.lng },
      currentOpeningHours: { openNow: true },
    },
    'washoku',
    NAGOYA,
  );
  assert.equal(r.rating, 4.2);
  assert.equal(r.reviewCount, 321);
  assert.equal(r.priceLevel, 2);
  assert.equal(r.priceRange, '¥1,000〜¥2,000');
  assert.equal(r.openNow, true);
  assert.ok(r.distance > 100 && r.distance < 120, `distance=${r.distance}`);
  assert.match(r.tabelogUrl, /^https:\/\/www\.google\.com\/search\?q=site%3Atabelog\.com/);
});

test('distanceMeters: 名古屋駅〜栄 はおよそ 2.5km', () => {
  const d = distanceMeters(NAGOYA, { lat: 35.168689, lng: 136.908457 });
  assert.ok(d > 2300 && d < 2600, `d=${d}`);
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('searchRestaurants はジャンルごとに Nearby Search を呼び、API キーとフィールドを送る', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    const places = body.includedTypes.includes('chinese_restaurant')
      ? [{ id: 'c1', displayName: { text: '中華' }, primaryType: 'chinese_restaurant', rating: 3.9, userRatingCount: 10 }]
      : [];
    return new Response(JSON.stringify({ places }), { status: 200 });
  };

  const groups = await searchRestaurants({ ...NAGOYA, radius: 1000 }, 'KEY');
  assert.equal(calls.length, groups.length);
  for (const call of calls) {
    assert.equal(call.url, 'https://places.googleapis.com/v1/places:searchNearby');
    assert.equal(call.headers['X-Goog-Api-Key'], 'KEY');
    assert.match(call.headers['X-Goog-FieldMask'], /places\.rating/);
    assert.equal(call.body.locationRestriction.circle.radius, 1000);
  }
  assert.deepEqual(groups.find((g) => g.id === 'chuka').restaurants.map((r) => r.id), ['c1']);
});

test('searchRestaurants は全リクエスト失敗時に API のエラーを投げる', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 });
  await assert.rejects(searchRestaurants({ ...NAGOYA, radius: 1000 }, 'BAD'), /API key not valid/);
});
