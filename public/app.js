const $ = (id) => document.getElementById(id);

const state = {
  data: null,
  tab: 'all',
};

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
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

function showStatus(message, isError = false) {
  const status = $('status');
  status.hidden = !message;
  status.textContent = message ?? '';
  status.classList.toggle('status-error', isError);
}

async function search(params) {
  showStatus('検索中…');
  $('results').hidden = true;
  const radius = $('radius').value;
  const query = new URLSearchParams({ ...params, radius });
  try {
    const res = await fetch(`/api/search?${query}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    state.data = body;
    state.tab = 'all';
    if (params.q) history.replaceState(null, '', `?${new URLSearchParams({ q: params.q, radius })}`);
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
  const { demo, center, radius } = state.data;
  $('results').hidden = false;
  $('demo-banner').hidden = !demo;
  $('center').textContent =
    `${center.name}${center.address ? `（${center.address}）` : ''} から半径 ${radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}`;

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

function card(r) {
  const meta = [
    r.genre,
    r.priceRange ?? (r.priceLevel ? '¥'.repeat(r.priceLevel) : null),
    formatDistance(r.distance),
  ].filter(Boolean);

  return el('li', { class: 'card' },
    el('div', { class: 'card-head' },
      el('h3', { class: 'card-name' }, r.name),
      r.openNow == null ? null : el('span', { class: `badge ${r.openNow ? 'badge-open' : 'badge-closed'}` }, r.openNow ? '営業中' : '営業時間外'),
    ),
    r.rating == null
      ? el('p', { class: 'rating rating-none' }, '評価なし')
      : el('p', { class: 'rating' },
          el('span', { class: 'stars', 'aria-hidden': 'true' }, stars(r.rating)),
          el('span', { class: 'rating-value' }, r.rating.toFixed(1)),
          el('span', { class: 'reviews' }, `（口コミ ${r.reviewCount.toLocaleString('ja-JP')}件）`),
        ),
    el('p', { class: 'meta' }, meta.join(' ・ ')),
    r.address ? el('p', { class: 'address' }, r.address) : null,
    el('p', { class: 'links' },
      r.mapsUrl ? el('a', { href: r.mapsUrl, target: '_blank', rel: 'noopener' }, 'Googleマップ') : null,
      el('a', { href: r.tabelogUrl, target: '_blank', rel: 'noopener' }, '食べログで探す'),
    ),
  );
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return showStatus('場所を入力してください', true);
  search({ q });
});

$('here').addEventListener('click', () => {
  if (!navigator.geolocation) return showStatus('このブラウザは位置情報に対応していません', true);
  showStatus('現在地を取得中…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      $('q').value = '';
      history.replaceState(null, '', location.pathname);
      search({ lat: coords.latitude, lng: coords.longitude });
    },
    (err) => showStatus(`現在地を取得できませんでした（${err.message}）`, true),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

for (const id of ['sort', 'min-rating', 'open-now']) {
  $(id).addEventListener('change', () => state.data && render());
}

// ?q=名古屋駅 付きの URL で開いたらそのまま検索する
const initial = new URLSearchParams(location.search);
if (initial.get('q')) {
  $('q').value = initial.get('q');
  if (initial.get('radius')) $('radius').value = initial.get('radius');
  search({ q: initial.get('q') });
}
