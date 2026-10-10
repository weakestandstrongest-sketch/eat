// PC で動かすときの回数の保存先 (JSON ファイル)。
// サーバーを複数台で動かすと台ごとに数えてしまうので、1 台で動かす前提。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function fileStore(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    data = null;
  }
  return {
    read: async () => data,
    write: async (next) => {
      data = next;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 2));
    },
  };
}
