// Google Places API の月間呼び出し回数を数え、無料枠を超えないよう止める。
// 回数の保存先 (store) は差し替えられる: PC ではファイル、Cloudflare では Durable Object。

export class UsageLimitError extends Error {
  constructor(message) {
    super(message);
    this.status = 429;
  }
}

// 料金区分ごとの表示名
const LABELS = {
  text: '地名検索 (Text Search Pro)',
  nearby: '周辺検索 (Nearby Search Enterprise)',
  details: '店舗詳細 (Place Details Enterprise + Atmosphere)',
  photo: '写真 (Place Details Photos)',
};

// 既定値は Google の毎月の無料枠。環境変数 MONTHLY_LIMIT_* で変えられる
export function limitsFromEnv(env) {
  return {
    text: Number(env.MONTHLY_LIMIT_TEXT) || 5000,
    nearby: Number(env.MONTHLY_LIMIT_NEARBY) || 1000,
    details: Number(env.MONTHLY_LIMIT_DETAILS) || 1000,
    photo: Number(env.MONTHLY_LIMIT_PHOTO) || 1000,
  };
}

// Google Cloud の請求月は太平洋時間で区切られる
export function currentMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

// store は { read(): Promise<data | null>, write(data): Promise<void> }
export function createUsage({ store, limits, now = () => new Date() }) {
  // 読んで・確かめて・書く間に別のリクエストが割り込まないよう 1 件ずつ処理する
  let queue = Promise.resolve();
  function exclusive(fn) {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }

  async function current() {
    const month = currentMonth(now());
    const data = await store.read();
    return data?.month === month ? data : { month, counts: {} };
  }

  function check(data, kind, n) {
    if ((data.counts[kind] ?? 0) + n > limits[kind]) {
      throw new UsageLimitError(
        `今月の${LABELS[kind]}の上限 (${limits[kind]}回) に達したため検索を止めています。来月になると再開します`,
      );
    }
  }

  return {
    // 残りが n 回以上なければ UsageLimitError を投げる (数えはしない)
    ensure: (kind, n) =>
      exclusive(async () => {
        check(await current(), kind, n);
      }),

    // 呼び出す前に回数を確保する。足りなければ 1 回も呼ばずに UsageLimitError を投げる。
    reserve: (kind, n) =>
      exclusive(async () => {
        const data = await current();
        check(data, kind, n);
        data.counts[kind] = (data.counts[kind] ?? 0) + n;
        await store.write(data);
      }),

    // 最大 n 回まで、残っている分だけ確保して、確保できた回数を返す
    reserveUpTo: (kind, n) =>
      exclusive(async () => {
        const data = await current();
        const allowed = Math.max(Math.min(n, limits[kind] - (data.counts[kind] ?? 0)), 0);
        if (allowed > 0) {
          data.counts[kind] = (data.counts[kind] ?? 0) + allowed;
          await store.write(data);
        }
        return allowed;
      }),

    summary: () =>
      exclusive(async () => {
        const data = await current();
        return {
          month: data.month,
          items: Object.keys(limits).map((kind) => ({
            kind,
            label: LABELS[kind],
            used: data.counts[kind] ?? 0,
            limit: limits[kind],
          })),
        };
      }),
  };
}
