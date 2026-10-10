const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  tab: 'all',
  lastParams: null,
  config: { demo: false, embedKey: null },
  // 詳細画面の地図の出発地を「現在地」に切り替えたときの位置
  here: null,
  map: null,
};

const LEAFLET_JS = {
  src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
};
const LEAFLET_CSS = {
  href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};

// 不動産広告と同じ「徒歩 1 分 = 80m」で計算する
const WALK_METERS_PER_MIN = 80;

// 口コミが少ない高評価店が上に来すぎないよう、件数で補正したスコア (ベイズ平均)
const PRIOR_RATING = 3.5;
const PRIOR_COUNT = 50;
function recommendScore(r) {
  if (r.rating == null) return -1;
  const n = r.reviewCount;
  return (n / (n + PRIOR_COUNT)) * r.rating + (PRIOR_COUNT / (n + PRIOR_COUNT)) * PRIOR_RATING;
}

const SORTERS = {
  score: (a, b) => recommendScore(b) - recommendScore(a),
  rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviewCount - a.reviewCount,
  reviews: (a, b) => b.reviewCount - a.reviewCount,
  distance: (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

function showStatus(message, isError = false) {
  const status = $('status');
  status.hidden = !message;
  status.textContent = message ?? '';
  status.classList.toggle('status-error', isError);
}

// 今月の Google Places API の利用回数 (デモモードでは usage が null)
function renderUsage(usage) {
  const box = $('usage');
  box.hidden = !usage;
  if (!usage) return;
  box.replaceChildren(
    `今月 (${usage.month}) の API 利用回数: `,
    ...usage.items.flatMap((item, i) => [
      i > 0 ? ' ／ ' : null,
      el('span', { class: item.used / item.limit >= 0.8 ? 'usage-warn' : null },
        `${item.label} ${item.used.toLocaleString('ja-JP')} / ${item.limit.toLocaleString('ja-JP')}回`),
    ]).filter(Boolean),
  );
}

// API を呼んで { res, body } を返す。ログインが必要ならログイン画面へ移る
async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 401) {
    location.href = '/login';
    return new Promise(() => {});
  }
  return { res, body: await res.json() };
}

async function search(params) {
  showStatus('検索中…');
  $('results').hidden = true;
  const radius = $('radius').value;
  const rank = $('rank').value;
  const query = new URLSearchParams({ ...params, radius, rank });
  try {
    const { res, body } = await getJson(`/api/search?${query}`);
    if (body.usage !== undefined) renderUsage(body.usage);
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    state.data = body;
    state.lastParams = params;
    state.tab = 'all';
    if (params.q) history.replaceState(null, '', `?${new URLSearchParams({ q: params.q, radius, rank })}`);
    showStatus(null);
    render();
  } catch (err) {
    showStatus(err.message, true);
  }
}

function filteredCategories() {
  const minRating = Number($('min-rating').value);
  const openOnly = $('open-now').checked;
  const sorter = SORTERS[$('sort').value];
  return state.data.categories.map((category) => ({
    ...category,
    restaurants: category.restaurants
      .filter((r) => (minRating === 0 || (r.rating ?? 0) >= minRating))
      .filter((r) => !openOnly || r.openNow === true)
      .sort(sorter),
  }));
}

function render() {
  const { demo, center, radius, rank } = state.data;
  $('results').hidden = false;
  $('demo-banner').hidden = !demo;
  $('center').textContent =
    `${center.name}${center.address ? `（${center.address}）` : ''} から半径 ${formatDistance(radius)}・${rank === 'distance' ? '近い店' : '人気の店'}から各ジャンル最大20件`;

  const categories = filteredCategories();
  const total = categories.reduce((sum, c) => sum + c.restaurants.length, 0);

  $('tabs').replaceChildren(
    tabButton('all', `すべて (${total})`),
    ...categories.map((c) => tabButton(c.id, `${c.emoji} ${c.label} (${c.restaurants.length})`)),
  );

  const visible = state.tab === 'all' ? categories : categories.filter((c) => c.id === state.tab);
  const sections = visible
    .filter((c) => c.restaurants.length > 0 || state.tab !== 'all')
    .map((c) =>
      el('section', { class: 'category' },
        el('h2', { class: 'category-title' }, `${c.emoji} ${c.label}`, el('span', { class: 'count' }, `${c.restaurants.length}件`)),
        c.restaurants.length
          ? el('ul', { class: 'cards' }, ...c.restaurants.map(card))
          : el('p', { class: 'empty' }, '条件に合うお店がありません'),
      ),
    );
  $('list').replaceChildren(...(sections.length ? sections : [el('p', { class: 'empty' }, '条件に合うお店がありません')]));
}

function tabButton(id, label) {
  const button = el('button', { class: `tab${state.tab === id ? ' tab-active' : ''}`, type: 'button' }, label);
  button.addEventListener('click', () => {
    state.tab = id;
    render();
  });
  return button;
}

function stars(rating) {
  const full = Math.round(rating);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function formatDistance(m) {
  if (m == null) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`;
}

function formatWalk(m) {
  if (m == null) return null;
  return `徒歩約${Math.max(1, Math.ceil(m / WALK_METERS_PER_MIN))}分（${formatDistance(m)}）`;
}

function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

function ratingLine(r) {
  if (r.rating == null) return el('p', { class: 'rating rating-none' }, 'Google の評価なし');
  return el('p', { class: 'rating' },
    el('span', { class: 'rating-source' }, 'Google'),
    el('span', { class: 'stars', 'aria-hidden': 'true' }, stars(r.rating)),
    el('span', { class: 'rating-value' }, r.rating.toFixed(1)),
    el('span', { class: 'reviews' }, `（口コミ ${r.reviewCount.toLocaleString('ja-JP')}件）`),
  );
}

function openBadge(openNow) {
  if (openNow == null) return null;
  return el('span', { class: `badge ${openNow ? 'badge-open' : 'badge-closed'}` }, openNow ? '営業中' : '営業時間外');
}

function externalLinks(r) {
  return el('p', { class: 'links' },
    r.mapsUrl ? link(r.mapsUrl, 'Googleマップ') : null,
    link(r.tabelogUrl, '食べログで探す'),
    link(r.hotpepperUrl, 'ホットペッパーで探す'),
  );
}

function card(r) {
  const meta = [
    r.genre,
    r.priceRange ?? (r.priceLevel ? '¥'.repeat(r.priceLevel) : null),
    formatWalk(r.distance),
  ].filter(Boolean);

  const item = el('li', { class: 'card', tabindex: '0', role: 'button', 'aria-haspopup': 'dialog' },
    el('div', { class: 'card-head' },
      el('h3', { class: 'card-name' }, r.name),
      openBadge(r.openNow),
    ),
    ratingLine(r),
    el('p', { class: 'meta' }, meta.join(' ・ ')),
    r.address ? el('p', { class: 'address' }, r.address) : null,
    externalLinks(r),
  );
  item.addEventListener('click', (e) => {
    if (!e.target.closest('a')) openDetail(r);
  });
  item.addEventListener('keydown', (e) => {
    if (e.target === item && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDetail(r);
    }
  });
  return item;
}

// ---- 詳細画面 ----

function origin() {
  const { center } = state.data;
  if (state.here) return { ...state.here, label: '現在地' };
  return { lat: center.lat, lng: center.lng, label: center.name === '現在地' ? '現在地' : `検索地点（${center.name}）` };
}

function appleMapsUrl(from, r) {
  const params = new URLSearchParams({ saddr: `${from.lat},${from.lng}`, daddr: `${r.lat},${r.lng}`, dirflg: 'w' });
  return `https://maps.apple.com/?${params}`;
}

function directionsUrl(from, r) {
  const params = new URLSearchParams({
    api: '1',
    origin: `${from.lat},${from.lng}`,
    destination: `${r.lat},${r.lng}`,
    travelmode: 'walking',
  });
  if (!state.data.demo) params.set('destination_place_id', r.id);
  return `https://www.google.com/maps/dir/?${params}`;
}

async function openDetail(r) {
  const dialog = $('detail');
  const body = $('detail-body');
  body.replaceChildren(
    el('div', { class: 'detail-head' },
      el('h2', { id: 'detail-name', class: 'detail-name' }, r.name),
      openBadge(r.openNow),
    ),
    ratingLine(r),
    el('p', { class: 'meta' }, [r.genre, r.priceRange].filter(Boolean).join(' ・ ')),
    el('section', { class: 'detail-section' },
      el('h3', {}, '場所'),
      el('div', { id: 'route' }),
    ),
    el('div', { id: 'detail-more' }, el('p', { class: 'muted' }, '詳しい情報を読み込み中…')),
  );
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  renderRoute(r);

  try {
    const { res, body: json } = await getJson(`/api/place?${new URLSearchParams({ id: r.id })}`);
    if (json.usage !== undefined) renderUsage(json.usage);
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    if ($('detail-name')?.textContent === r.name) $('detail-more').replaceChildren(...detailSections(json.place, r).filter(Boolean));
  } catch (err) {
    $('detail-more')?.replaceChildren(
      el('p', { class: 'status-error' }, `詳しい情報を取得できませんでした（${err.message}）`),
      externalLinks(r),
    );
  }
}

function renderRoute(r) {
  const box = $('route');
  if (r.lat == null) {
    box.replaceChildren(el('p', { class: 'muted' }, '位置情報がありません'));
    return;
  }
  const from = origin();
  const dist = distanceMeters(from, r);
  const mapBox = el('div', { class: 'map' });
  const hereButton = state.here || state.data.center.name === '現在地'
    ? null
    : el('button', { class: 'btn btn-small', type: 'button' }, '📍 現在地からにする');
  hereButton?.addEventListener('click', () => useCurrentLocation(r, hereButton));

  box.replaceChildren(
    mapBox,
    el('p', { class: 'route-legend' },
      el('span', { class: 'dot dot-origin' }), from.label, ' → ',
      el('span', { class: 'dot dot-shop' }), 'お店',
      el('strong', {}, `　直線で${formatWalk(dist)}`),
    ),
    el('p', { class: 'route-actions' },
      link(directionsUrl(from, r), 'Googleマップで道順'),
      link(appleMapsUrl(from, r), 'Appleマップで道順'),
      hereButton,
    ),
  );
  drawMap(mapBox, from, r);
}

function useCurrentLocation(r, button) {
  if (!navigator.geolocation) {
    button.textContent = '位置情報に対応していません';
    return;
  }
  button.disabled = true;
  button.textContent = '現在地を取得中…';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      state.here = { lat: coords.latitude, lng: coords.longitude };
      renderRoute(r);
    },
    (err) => {
      button.disabled = false;
      button.textContent = `取得できませんでした（${err.message}）`;
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// Maps Embed API のキーがあれば Google マップの徒歩ルート、なければ OpenStreetMap に 2 点を表示する
function drawMap(box, from, r) {
  state.map?.remove();
  state.map = null;

  if (state.config.embedKey) {
    const params = new URLSearchParams({
      key: state.config.embedKey,
      origin: `${from.lat},${from.lng}`,
      destination: state.data.demo ? `${r.lat},${r.lng}` : `place_id:${r.id}`,
      mode: 'walking',
      language: 'ja',
      region: 'JP',
    });
    box.append(el('iframe', {
      class: 'map-frame',
      title: `${from.label}から${r.name}までの地図`,
      src: `https://www.google.com/maps/embed/v1/directions?${params}`,
      loading: 'lazy',
      referrerpolicy: 'no-referrer-when-downgrade',
      allowfullscreen: '',
    }));
    return;
  }

  loadLeaflet()
    .then((L) => {
      if (!box.isConnected) return;
      const map = L.map(box, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const a = [from.lat, from.lng];
      const b = [r.lat, r.lng];
      L.polyline([a, b], { color: '#868e96', weight: 3, dashArray: '6 6' }).addTo(map);
      L.circleMarker(a, { radius: 9, color: '#fff', weight: 2, fillColor: '#1c7ed6', fillOpacity: 1 })
        .bindTooltip(from.label, { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(map);
      L.circleMarker(b, { radius: 9, color: '#fff', weight: 2, fillColor: '#e8590c', fillOpacity: 1 })
        .bindTooltip(r.name, { permanent: true, direction: 'top', offset: [0, -8] })
        .addTo(map);
      map.fitBounds([a, b], { padding: [48, 48], maxZoom: 17 });
      state.map = map;
    })
    .catch(() => {
      box.replaceChildren(el('p', { class: 'muted map-error' }, '地図を読み込めませんでした。下のリンクから地図アプリで確認できます。'));
    });
}

let leafletPromise = null;
function loadLeaflet() {
  leafletPromise ??= new Promise((resolve, reject) => {
    document.head.append(el('link', { rel: 'stylesheet', crossorigin: '', ...LEAFLET_CSS }));
    const script = el('script', { crossorigin: '', ...LEAFLET_JS });
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      leafletPromise = null;
      script.remove();
      reject(new Error('Leaflet を読み込めませんでした'));
    };
    document.head.append(script);
  });
  return leafletPromise;
}

function detailSections(d, r) {
  const info = [
    ['住所', d.address],
    ['電話', d.phone ? el('a', { href: `tel:${d.phone.replace(/[^\d+]/g, '')}` }, d.phone) : null],
    ['予算', d.priceRange],
    ['営業時間', d.hours.length ? el('ul', { class: 'hours' }, d.hours.map((h) => el('li', {}, h))) : null],
    ['ウェブサイト', d.website ? link(d.website, d.website.replace(/^https?:\/\//, '').replace(/\/$/, '')) : null],
  ].filter(([, value]) => value);

  return [
    d.photos.length
      ? el('div', { class: 'photos' },
          d.photos.map((p) =>
            el('figure', { class: 'photo' },
              el('img', { src: p.url, alt: `${d.name}の写真`, loading: 'lazy' }),
              p.author ? el('figcaption', {}, '写真: ', p.authorUri ? link(p.authorUri, p.author) : p.author) : null,
            ),
          ),
        )
      : null,
    d.summary ? el('p', { class: 'summary' }, d.summary) : null,
    el('section', { class: 'detail-section' },
      el('h3', {}, 'お店の情報'),
      el('dl', { class: 'info' }, info.flatMap(([label, value]) => [el('dt', {}, label), el('dd', {}, value)])),
      d.features.length ? el('ul', { class: 'features' }, d.features.map((f) => el('li', {}, f))) : null,
    ),
    el('section', { class: 'detail-section' },
      el('h3', {}, '口コミ（Google）'),
      d.reviews.length
        ? el('ul', { class: 'reviews-list' },
            d.reviews.map((rv) =>
              el('li', { class: 'review' },
                el('p', { class: 'review-head' },
                  rv.rating ? el('span', { class: 'stars' }, stars(rv.rating)) : null,
                  rv.authorUri ? link(rv.authorUri, rv.author) : el('span', {}, rv.author),
                  el('span', { class: 'muted' }, rv.time),
                ),
                el('p', { class: 'review-text' }, rv.text),
              ),
            ),
          )
        : el('p', { class: 'muted' }, '口コミはまだありません'),
    ),
    el('section', { class: 'detail-section' },
      el('h3', {}, 'ほかのサイトで見る'),
      el('p', { class: 'muted small' }, '食べログ・ホットペッパーの評価は外部から取得できないため、各サイトで確認してください。'),
      externalLinks({ ...r, ...d, mapsUrl: d.mapsUrl ?? r.mapsUrl }),
    ),
  ];
}

$('detail-close').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('click', (e) => {
  // ダイアログの外側 (背景) をクリックしたら閉じる
  if (e.target === e.currentTarget) e.currentTarget.close();
});
$('detail').addEventListener('close', () => {
  state.map?.remove();
  state.map = null;
});

// ---- 検索フォーム ----

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return showStatus('場所を入力してください', true);
  state.here = null;
  search({ q });
});

$('here').addEventListener('click', () => {
  if (!navigator.geolocation) return showStatus('このブラウザは位置情報に対応していません', true);
  showStatus('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      $('q').value = '';
      state.here = null;
      history.replaceState(null, '', location.pathname);
      search({ lat: coords.latitude, lng: coords.longitude });
    },
    (err) => showStatus(`現在地を取得できませんでした（${err.message}）`, true),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// 集め方を変えたら、並び順も合わせて取り直す (Google の API を呼び直す)
$('rank').addEventListener('change', () => {
  $('sort').value = $('rank').value === 'distance' ? 'distance' : 'score';
  if (state.lastParams) search(state.lastParams);
});

for (const id of ['sort', 'min-rating', 'open-now']) {
  $(id).addEventListener('change', () => state.data && render());
}

getJson('/api/config')
  .then(({ body: config }) => {
    state.config = config;
    renderUsage(config.usage);
  })
  .catch(() => {});

// ?q=名古屋駅 付きの URL で開いたらそのまま検索する
const initial = new URLSearchParams(location.search);
if (initial.get('q')) {
  $('q').value = initial.get('q');
  if (initial.get('radius')) $('radius').value = initial.get('radius');
  if (initial.get('rank') === 'distance') {
    $('rank').value = 'distance';
    $('sort').value = 'distance';
  }
  search({ q: initial.get('q') });
}
