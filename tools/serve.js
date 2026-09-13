// 動作確認用の静的サーバー。`npm start` で http://localhost:8080 に出す。
// ビルドは無し。ここで配るファイルがそのまま本番のアセットになる。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? `${path}index.html` : path);

  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
