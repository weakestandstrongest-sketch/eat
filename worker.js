// Cloudflare Workers で動かすときの入口 (npm run deploy でアップロードする)。
// 画面のファイル (public/) は Cloudflare がそのまま返し、それ以外がここに来る。
import { createHandler } from './lib/app.js';
import { createUsage, limitsFromEnv, UsageLimitError } from './lib/usage.js';

const USAGE_OPS = new Set(['ensure', 'reserve', 'reserveUpTo', 'summary']);

// API の呼び出し回数を保存する Durable Object。
// 1 か所にまとめて 1 件ずつ処理するので、同時に検索しても数え漏れしない。
export class UsageCounter {
  constructor(ctx, env) {
    this.store = {
      read: () => ctx.storage.get('usage'),
      write: (data) => ctx.storage.put('usage', data),
    };
    this.limits = limitsFromEnv(env);
  }

  async fetch(request) {
    const { op, args = [] } = await request.json();
    if (!USAGE_OPS.has(op)) return Response.json({ error: 'unknown op' }, { status: 400 });
    // Durable Object は 1 件ずつ処理するので、リクエストごとに作っても数え漏れしない
    const usage = createUsage({ store: this.store, limits: this.limits });
    try {
      return Response.json({ result: (await usage[op](...args)) ?? null });
    } catch (err) {
      if (err instanceof UsageLimitError) return Response.json({ limitError: err.message });
      throw err;
    }
  }
}

// Worker から UsageCounter を、PC 版の usage と同じ形で使えるようにする。
// 接続 (stub) はリクエストをまたいで使い回せないので、呼ぶたびに取り直す。
function remoteUsage(getStub) {
  const call = async (op, ...args) => {
    const res = await getStub().fetch('https://usage.internal/', {
      method: 'POST',
      body: JSON.stringify({ op, args }),
    });
    const body = await res.json();
    if (body.limitError) throw new UsageLimitError(body.limitError);
    if (!res.ok) throw new Error(body.error ?? `usage HTTP ${res.status}`);
    return body.result;
  };
  return Object.fromEntries([...USAGE_OPS].map((op) => [op, (...args) => call(op, ...args)]));
}

let handle = null;

export default {
  async fetch(request, env) {
    if (!handle) {
      const apiKey = env.GOOGLE_MAPS_API_KEY ?? '';
      const demo = !apiKey || env.DEMO === '1';
      handle = createHandler({
        apiKey,
        demo,
        embedKey: env.GOOGLE_MAPS_EMBED_KEY ?? '',
        password: env.APP_PASSWORD ?? '',
        usage: demo ? null : remoteUsage(() => env.USAGE.get(env.USAGE.idFromName('usage'))),
      });
    }
    return (await handle(request)) ?? env.ASSETS.fetch(request);
  },
};
