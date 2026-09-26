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
//   GET  /log/<key>    -> [{"t":...,"h":22,"target":15,"score":40}, ...]（古い順）
//   POST /log/<key>    -> 送ったプレイを足して、足したあとの件数を返す
//
// プレイの記録は月ごとに分けて置く（log:<key>:2026-09）。1回の書き込みで触る量を
// 小さく保つため。持つのは「いつ・お題・スコア」だけ。

const MIN_TARGET = 10;   // src/game/config.js の TARGETS と合わせる
const MAX_TARGET = 25;
const MAX_BODY_BYTES = 2000;
const MAX_LOG_BODY_BYTES = 20000;
const MAX_PER_MONTH = 2000;        // src/shared/log.js と合わせる

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
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

/** プレイの記録1件。おかしければ null（判定は src/shared/log.js と同じ） */
function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = Number(raw.t);
  const h = Number(raw.h);
  const target = Number(raw.target);
  const score = Number(raw.score);
  if (!Number.isInteger(t) || t <= 0) return null;
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(target) || target < MIN_TARGET || target > MAX_TARGET) return null;
  if (!Number.isInteger(score) || score < 0 || score > 10000) return null;
  return { t, h, target, score };
}

function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

/** 同じプレイ（同じ時刻）は1件にまとめて、古い順に並べる */
function mergeEntries(...sources) {
  const byTime = new Map();
  for (const source of sources) {
    for (const entry of normalizeEntries(source)) {
      if (!byTime.has(entry.t)) byTime.set(entry.t, entry);
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

function monthOf(t) {
  const date = new Date(t);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS },
});

/** プレイの記録。月ごとの置き場所に分けて足していく */
async function handleLog(request, env, name) {
  const prefix = `log:${name}:`;

  if (request.method === 'GET') {
    const listed = await env.BESTS.list({ prefix });
    const months = await Promise.all(listed.keys.map(({ name: key }) => env.BESTS.get(key, 'json')));
    return json(mergeEntries(...months));
  }

  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_LOG_BODY_BYTES) return json({ error: 'too large' }, 413);

    let incoming;
    try {
      incoming = JSON.parse(text);
    } catch {
      return json({ error: 'invalid json' }, 400);
    }

    const entries = normalizeEntries(Array.isArray(incoming) ? incoming : [incoming]);
    if (entries.length === 0) return json({ error: 'nothing to add' }, 400);

    // 月ごとにまとめて、触る置き場所だけを書き換える
    const byMonth = new Map();
    for (const entry of entries) {
      const month = monthOf(entry.t);
      byMonth.set(month, [...(byMonth.get(month) ?? []), entry]);
    }

    let added = 0;
    for (const [month, monthEntries] of byMonth) {
      const key = `${prefix}${month}`;
      const stored = await env.BESTS.get(key, 'json');
      const before = mergeEntries(stored).length;
      const merged = mergeEntries(stored, monthEntries).slice(-MAX_PER_MONTH);
      added += merged.length - before;
      await env.BESTS.put(key, JSON.stringify(merged));
    }
    return json({ added });
  }

  return json({ error: 'method not allowed' }, 405);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const { pathname } = new URL(request.url);
    const logMatch = /^\/log\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
    if (logMatch) return handleLog(request, env, logMatch[1]);

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
