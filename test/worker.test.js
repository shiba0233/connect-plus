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
