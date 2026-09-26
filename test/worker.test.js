import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../worker/index.js';

/** KV の代わり */
function createEnv(initial = null) {
  const store = new Map();
  if (initial) store.set('bests:testkey', JSON.stringify(initial));
  return {
    store,
    BESTS: {
      get: async (key, type) => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === 'json' ? JSON.parse(raw) : raw;
      },
      put: async (key, value) => { store.set(key, value); },
      list: async ({ prefix }) => ({
        keys: [...store.keys()].filter((key) => key.startsWith(prefix)).sort().map((name) => ({ name })),
      }),
    },
  };
}

const url = (path = '/bests/testkey') => `https://bests.example${path}`;
const get = (env, path) => worker.fetch(new Request(url(path)), env);
const put = (env, body, path) => worker.fetch(new Request(url(path), {
  method: 'PUT',
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), env);

test('記録が無ければ空を返す', async () => {
  const response = await get(createEnv());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {});
});

test('送った記録を保存して読み出せる', async () => {
  const env = createEnv();
  const saved = await (await put(env, { 10: 48, 15: 32 })).json();
  assert.deepEqual(saved, { 10: 48, 15: 32 });
  assert.deepEqual(await (await get(env)).json(), { 10: 48, 15: 32 });
});

test('低いスコアでは上書きされない', async () => {
  const env = createEnv({ 10: 100, 15: 20 });
  const merged = await (await put(env, { 10: 3, 15: 50, 20: 7 })).json();
  assert.deepEqual(merged, { 10: 100, 15: 50, 20: 7 }, '高い方だけが残る');
  assert.deepEqual(await (await get(env)).json(), { 10: 100, 15: 50, 20: 7 });
});

test('お題として存在しない値は受け付けない', async () => {
  const env = createEnv();
  const merged = await (await put(env, { 9: 50, 26: 50, 15: 10, hoge: 3 })).json();
  assert.deepEqual(merged, { 15: 10 });
});

test('数でないスコアや負の数は受け付けない', async () => {
  const env = createEnv({ 10: 5 });
  const merged = await (await put(env, { 10: 'たくさん', 11: -4, 12: 1.5, 13: 8 })).json();
  assert.deepEqual(merged, { 10: 5, 13: 8 });
});

test('壊れた JSON は断る。保存済みの記録は無事', async () => {
  const env = createEnv({ 10: 42 });
  const response = await put(env, '{こわれている');
  assert.equal(response.status, 400);
  assert.deepEqual(await (await get(env)).json(), { 10: 42 });
});

test('大きすぎる本文は断る', async () => {
  const env = createEnv();
  const response = await put(env, 'x'.repeat(3000));
  assert.equal(response.status, 413);
});

test('置き場所ごとに分かれている', async () => {
  const env = createEnv();
  await put(env, { 10: 11 }, '/bests/aaa');
  await put(env, { 10: 22 }, '/bests/bbb');
  assert.deepEqual(await (await get(env, '/bests/aaa')).json(), { 10: 11 });
  assert.deepEqual(await (await get(env, '/bests/bbb')).json(), { 10: 22 });
});

test('知らない URL や使えない method は断る', async () => {
  const env = createEnv();
  assert.equal((await get(env, '/')).status, 404);
  assert.equal((await get(env, '/bests/')).status, 404);
  assert.equal((await get(env, '/bests/ダメな文字')).status, 404);
  assert.equal((await worker.fetch(new Request(url(), { method: 'DELETE' }), env)).status, 405);
});

test('ブラウザから呼べるように CORS を返す', async () => {
  const env = createEnv();
  const preflight = await worker.fetch(new Request(url(), { method: 'OPTIONS' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.equal((await get(env)).headers.get('access-control-allow-origin'), '*');
});

test('保存先に残るのはお題とスコアだけ', async () => {
  const env = createEnv();
  await put(env, { 10: 48, 端末: 'iPhone', name: 'shiba' });
  assert.deepEqual(JSON.parse(env.store.get('bests:testkey')), { 10: 48 });
});

test('保存先とアプリで、記録の扱いが食い違わない', async () => {
  // worker/index.js はダッシュボードに貼れるよう1枚で完結させてあり、判定が
  // src/shared/bests.js と二重になっている。両者がずれていないことを確かめる。
  const { mergeBests } = await import('../src/shared/bests.js');
  const { createRng, randomInt } = await import('../src/game/rng.js');
  const rng = createRng(4242);

  const randomBests = () => {
    const out = {};
    for (let i = 0; i < 6; i += 1) {
      // わざと範囲外や変な値も混ぜる
      const target = randomInt(rng, 8, 27);
      const score = rng() < 0.15 ? ['たくさん', -1, 1.5, null][randomInt(rng, 0, 3)] : randomInt(rng, 0, 500);
      out[target] = score;
    }
    return out;
  };

  for (let i = 0; i < 300; i += 1) {
    const stored = randomBests();
    const incoming = randomBests();
    const env = createEnv(stored);
    const fromWorker = await (await put(env, incoming)).json();
    const fromApp = mergeBests(stored, incoming);
    assert.deepEqual(
      fromWorker,
      JSON.parse(JSON.stringify(fromApp)),
      `食い違い\n stored=${JSON.stringify(stored)}\n incoming=${JSON.stringify(incoming)}`,
    );
  }
});


// ---------------------------------------------------------------- プレイの記録

const logUrl = (name = 'testkey') => `https://bests.example/log/${name}`;
const getLog = (env, name) => worker.fetch(new Request(logUrl(name)), env);
const postLog = (env, body, name) => worker.fetch(new Request(logUrl(name), {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
}), env);

const play = (t, h, target, score) => ({ t, h, target, score });

test('記録が無ければ空の配列', async () => {
  const response = await getLog(createEnv());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
});

test('プレイを足して、古い順に読み出せる', async () => {
  const env = createEnv();
  const later = Date.UTC(2026, 8, 20, 22, 0);
  const earlier = Date.UTC(2026, 8, 19, 9, 0);
  await postLog(env, [play(later, 22, 15, 40)]);
  await postLog(env, play(earlier, 9, 12, 18));    // 1件だけでも送れる
  assert.deepEqual(await (await getLog(env)).json(), [
    { t: earlier, h: 9, target: 12, score: 18 },
    { t: later, h: 22, target: 15, score: 40 },
  ]);
});

test('同じプレイを二重に送っても増えない', async () => {
  const env = createEnv();
  const t = Date.UTC(2026, 8, 20, 22, 0);
  assert.deepEqual(await (await postLog(env, [play(t, 22, 15, 40)])).json(), { added: 1 });
  assert.deepEqual(await (await postLog(env, [play(t, 22, 15, 40)])).json(), { added: 0 });
  assert.equal((await (await getLog(env)).json()).length, 1);
});

test('月ごとに分けて置く', async () => {
  const env = createEnv();
  await postLog(env, [
    play(Date.UTC(2026, 8, 30, 23, 0), 23, 15, 10),
    play(Date.UTC(2026, 9, 1, 0, 30), 0, 15, 12),
  ]);
  const keys = [...env.store.keys()].filter((k) => k.startsWith('log:'));
  assert.deepEqual(keys.sort(), ['log:testkey:2026-09', 'log:testkey:2026-10']);
  assert.equal((await (await getLog(env)).json()).length, 2, '読むときは月をまたいで1本に');
});

test('おかしな記録は受け付けない', async () => {
  const env = createEnv();
  const t = Date.UTC(2026, 8, 20, 22, 0);
  await postLog(env, [
    play(t, 22, 15, 40),
    play(t + 1, 24, 15, 40),        // 24時台は無い
    play(t + 2, 22, 9, 40),         // お題の範囲外
    play(t + 3, 22, 15, -1),        // 負のスコア
    { t: t + 4, h: 22, target: 15, score: 40, 位置: '東京' },   // 余計な項目
  ]);
  const log = await (await getLog(env)).json();
  assert.equal(log.length, 2);
  assert.deepEqual(Object.keys(log[1]).sort(), ['h', 'score', 't', 'target'], '余計な項目は落ちる');
});

test('中身が全部おかしければ断る', async () => {
  const env = createEnv();
  assert.equal((await postLog(env, [{ こわれている: true }])).status, 400);
  assert.equal((await postLog(env, '{壊れたJSON')).status, 400);
  assert.equal((await postLog(env, 'x'.repeat(30000))).status, 413);
});

test('置き場所ごとに分かれている', async () => {
  const env = createEnv();
  await postLog(env, [play(Date.UTC(2026, 8, 20, 1, 0), 1, 15, 5)], 'aaa');
  await postLog(env, [play(Date.UTC(2026, 8, 20, 2, 0), 2, 15, 7)], 'bbb');
  assert.equal((await (await getLog(env, 'aaa')).json()).length, 1);
  assert.equal((await (await getLog(env, 'bbb')).json())[0].score, 7);
});

test('記録の URL でも使えない method は断る', async () => {
  const env = createEnv();
  assert.equal((await worker.fetch(new Request(logUrl(), { method: 'DELETE' }), env)).status, 405);
});

test('保存先とアプリで、プレイの記録の扱いが食い違わない', async () => {
  const { normalizeEntries, mergeEntries } = await import('../src/shared/log.js');
  const { createRng, randomInt } = await import('../src/game/rng.js');
  const rng = createRng(31337);
  const base = Date.UTC(2026, 8, 1);

  for (let i = 0; i < 100; i += 1) {
    const raw = Array.from({ length: 5 }, () => ({
      t: base + randomInt(rng, 0, 1000) * 60000,
      h: randomInt(rng, -1, 25),
      target: randomInt(rng, 8, 27),
      score: rng() < 0.2 ? 'たくさん' : randomInt(rng, 0, 200),
    }));
    const env = createEnv();
    await postLog(env, raw);
    const fromWorker = await (await getLog(env)).json();
    const fromApp = mergeEntries(normalizeEntries(raw));
    assert.deepEqual(fromWorker, JSON.parse(JSON.stringify(fromApp)));
  }
});
