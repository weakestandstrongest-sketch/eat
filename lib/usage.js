// Google Places API の月間呼び出し回数を数え、無料枠を超えないよう止める。
// 回数はファイルに保存するので、サーバーを再起動しても引き継がれる。
// サーバーを複数台で動かすと台ごとに数えてしまうので、1 台で動かす前提。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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

// Google Cloud の請求月は太平洋時間で区切られる
export function currentMonth(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).format(now);
}

export function createUsage({ file, limits, now = () => new Date() }) {
  let data = load();

  function load() {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return { month: currentMonth(now()), counts: {} };
    }
  }

  function save() {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2));
  }

  function rollover() {
    const month = currentMonth(now());
    if (data.month !== month) data = { month, counts: {} };
  }

  function ensure(kind, n) {
    rollover();
    if ((data.counts[kind] ?? 0) + n > limits[kind]) {
      throw new UsageLimitError(
        `今月の${LABELS[kind]}の上限 (${limits[kind]}回) に達したため検索を止めています。来月になると再開します`,
      );
    }
  }

  return {
    // 残りが n 回以上なければ UsageLimitError を投げる (数えはしない)
    ensure,

    remaining(kind) {
      rollover();
      return Math.max(limits[kind] - (data.counts[kind] ?? 0), 0);
    },

    // 呼び出す前に回数を確保する。足りなければ 1 回も呼ばずに UsageLimitError を投げる。
    reserve(kind, n) {
      ensure(kind, n);
      data.counts[kind] = (data.counts[kind] ?? 0) + n;
      save();
    },

    summary() {
      rollover();
      return {
        month: data.month,
        items: Object.keys(limits).map((kind) => ({
          kind,
          label: LABELS[kind],
          used: data.counts[kind] ?? 0,
          limit: limits[kind],
        })),
      };
    },
  };
}
