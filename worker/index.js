// 自己ベストの保存先。Cloudflare Workers + KV で動かす。
//
// このファイルは1枚で完結させてある。Cloudflare のダッシュボードに貼り付けるだけで
// 動かせるようにするため（手元に Node を入れなくてよい）。
// そのぶん判定が src/shared/bests.js と二重になるので、test/worker.test.js で
// 両者が同じ結果になることを確かめている。お題の範囲を変えたらここも直す。
//
// 置いているのはお題ごとのスコアだけ。個人を特定できるものは持たない。
// リポジトリが public なので、この URL と置き場所の名前は誰でも見られる前提で作る。
//   - 書き込みは「お題ごとに高い方を採る」だけ。低い値では上書きされないので、
//     いたずらされても記録が消えることはない
//   - 受け取る値はお題として存在するものだけに絞る
//
// 使い方:
//   GET  /bests/<key>  -> {"10":48,"15":32}
//   PUT  /bests/<key>  -> 送った記録と保存済みを合わせたものを返す

const MIN_TARGET = 10;   // src/game/config.js の TARGETS と合わせる
const MAX_TARGET = 25;
const MAX_BODY_BYTES = 2000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** 外から来た値を、信用できる形に揃える */
function normalizeBests(raw) {
  const bests = {};
  if (!raw || typeof raw !== 'object') return bests;
  for (const [key, value] of Object.entries(raw)) {
    const target = Number(key);
    const score = Number(value);
    if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) continue;
    if (!Number.isInteger(score) || score < 0) continue;
    bests[target] = score;
  }
  return bests;
}

/** お題ごとに高い方を採る */
function mergeBests(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [key, score] of Object.entries(normalizeBests(source))) {
      const target = Number(key);
      if (!Number.isInteger(merged[target]) || merged[target] < score) merged[target] = score;
    }
  }
  return merged;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);
    const match = /^\/bests\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
    if (!match) return json({ error: 'not found' }, 404);
    const key = `bests:${match[1]}`;

    if (request.method === 'GET') {
      return json(normalizeBests(await env.BESTS.get(key, 'json')));
    }

    if (request.method === 'PUT') {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: 'too large' }, 413);

      let incoming;
      try {
        incoming = JSON.parse(text);
      } catch {
        return json({ error: 'invalid json' }, 400);
      }

      const stored = await env.BESTS.get(key, 'json');
      const merged = mergeBests(stored, incoming);   // 高い方を採るだけ
      await env.BESTS.put(key, JSON.stringify(merged));
      return json(merged);
    }

    return json({ error: 'method not allowed' }, 405);
  },
};
