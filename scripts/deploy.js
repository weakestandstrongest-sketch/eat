// npm run deploy: Cloudflare Workers にアップロードして、iPhone などから URL で開けるようにする。
// .env の GOOGLE_MAPS_API_KEY を使い、初回だけログイン用のパスワードを決めてもらう。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT_DIR, '.env');

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

let wranglerBin;
try {
  const require = createRequire(import.meta.url);
  wranglerBin = path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
} catch {
  fail('wrangler が見つかりません。先に npm install を実行してください');
}

const wrangler = (args, options = {}) =>
  spawnSync(process.execPath, [wranglerBin, ...args], { cwd: ROOT_DIR, stdio: 'inherit', ...options });

// .env の KEY=VALUE を書き換える (なければ足す)
function saveEnv(key, value) {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  writeFileSync(ENV_FILE, pattern.test(text) ? text.replace(pattern, line) : `${text.replace(/\n?$/, '\n')}${line}\n`);
}

try {
  process.loadEnvFile(ENV_FILE);
} catch {
  // .env がなければ下のチェックで止まる
}

const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
if (!apiKey) fail('.env に GOOGLE_MAPS_API_KEY が書かれていません。README の「実データで動かす」を先に済ませてください');

let password = process.env.APP_PASSWORD?.trim();
if (!password) {
  console.log('\nアプリを開くときのパスワードを決めます（URL を知っている他人に使われないようにするため）。');
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  while (!password) {
    process.stdout.write('パスワード（8 文字以上）: ');
    const { value, done } = await lines.next();
    if (done) fail('パスワードが入力されませんでした');
    if (value.trim().length >= 8) password = value.trim();
    else console.log('8 文字以上にしてください。');
  }
  rl.close();
  saveEnv('APP_PASSWORD', password);
  console.log('.env に APP_PASSWORD として保存しました（忘れたらここで確認できます）。');
}

console.log('\n[1/3] Cloudflare へのログインを確認しています…');
const who = wrangler(['whoami'], { stdio: 'pipe', encoding: 'utf8' });
if (/not authenticated/i.test(`${who.stdout}${who.stderr}`)) {
  console.log('ブラウザが開くので、Cloudflare にログインして「Allow」を押してください。');
  if (wrangler(['login']).status !== 0) fail('ログインできませんでした');
}

console.log('\n[2/3] アプリをアップロードしています…');
const vars = ['MONTHLY_LIMIT_TEXT', 'MONTHLY_LIMIT_NEARBY', 'MONTHLY_LIMIT_DETAILS', 'MONTHLY_LIMIT_PHOTO', 'GOOGLE_MAPS_EMBED_KEY']
  .filter((key) => process.env[key]?.trim())
  .flatMap((key) => ['--var', `${key}:${process.env[key].trim()}`]);
if (wrangler(['deploy', ...vars]).status !== 0) fail('アップロードに失敗しました。上のメッセージを確認してください');

console.log('\n[3/3] API キーとパスワードを登録しています…');
for (const [name, value] of [['GOOGLE_MAPS_API_KEY', apiKey], ['APP_PASSWORD', password]]) {
  const result = wrangler(['secret', 'put', name], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.status !== 0) fail(`${name} を登録できませんでした`);
}

console.log(`
✔ 完了しました！

  上に表示された https://eat.〜.workers.dev の URL を iPhone の Safari で開き、
  パスワードを入れてください。共有ボタン →「ホーム画面に追加」でアイコンになります。

  アプリを直したときや .env を変えたときは、もう一度 npm run deploy を実行してください。
`);
