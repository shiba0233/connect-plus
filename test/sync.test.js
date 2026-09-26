import test from 'node:test';
import assert from 'node:assert/strict';

const CONFIG = { url: 'https://example.invalid', key: 'testkey' };

function installStorage(initial = {}) {
  const data = new Map();
  if (Object.keys(initial).length) data.set('kotobuki.bests.v1', JSON.stringify(initial));
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  return data;
}

/** fetch の代わり。呼ばれた内容を記録して、決めた応答を返す */
function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    return handler(calls[calls.length - 1]);
  };
  return calls;
}

const ok = (body) => ({ ok: true, json: async () => body });
const fail = () => { throw new Error('オフライン'); };

async function load() {
  return import(`../src/app/sync.js?${Math.random()}`);
}

test('保存先が設定されていなければ何もしない', async () => {
  installStorage({ 10: 5 });
  const calls = installFetch(() => ok({}));
  const sync = await load();

  assert.equal(sync.isConfigured({ url: '' }), false);
  assert.equal(await sync.pull({ url: '', key: 'x' }), null);
  assert.equal(await sync.push({ url: '', key: 'x' }), null);
  await sync.syncOnStart(() => {}, { url: '', key: 'x' });
  assert.equal(calls.length, 0, '通信していない');
});

test('起動時に保存先から取り込む', async () => {
  installStorage({ 10: 5 });
  const calls = installFetch(() => ok({ 10: 40, 15: 12 }));
  const sync = await load();

  const result = await sync.pull(CONFIG);
  assert.equal(calls[0].url, 'https://example.invalid/bests/testkey');
  assert.equal(calls[0].method, 'GET');
  assert.equal(result.updated, 2);
  assert.deepEqual(JSON.parse(localStorage.getItem('kotobuki.bests.v1')), { 10: 40, 15: 12 });
});

test('取り込みで記録が下がることはない', async () => {
  installStorage({ 10: 99 });
  installFetch(() => ok({ 10: 40 }));
  const sync = await load();

  await sync.pull(CONFIG);
  assert.deepEqual(JSON.parse(localStorage.getItem('kotobuki.bests.v1')), { 10: 99 });
});

test('端末の記録を送り、返ってきたものを取り込む', async () => {
  installStorage({ 10: 50 });
  const calls = installFetch(() => ok({ 10: 50, 20: 33 }));   // 他の端末で伸びた記録が混ざって返る
  const sync = await load();

  const result = await sync.push(CONFIG);
  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { 10: 50 });
  assert.equal(result.updated, 1);
  assert.deepEqual(JSON.parse(localStorage.getItem('kotobuki.bests.v1')), { 10: 50, 20: 33 });
});

test('通信できなくても落ちない。次の起動で送り直す', async () => {
  const data = installStorage({ 10: 50 });
  installFetch(fail);
  let sync = await load();

  assert.equal(await sync.push(CONFIG), null, 'エラーにせず null を返す');
  assert.equal(data.get('kotobuki.sync.pending.v1'), '1', '送りそびれを覚えている');
  assert.deepEqual(JSON.parse(data.get('kotobuki.bests.v1')), { 10: 50 }, '端末の記録は無事');

  // 次の起動。保存先は空だが、送りそびれているので送り直す
  const calls = installFetch((call) => ok(call.method === 'GET' ? {} : { 10: 50 }));
  sync = await load();
  await sync.syncOnStart(() => {}, CONFIG);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT']);
  assert.equal(data.get('kotobuki.sync.pending.v1'), undefined, '送れたので目印を消す');
});

test('端末の方が進んでいれば、取り込んだあとに送り返す', async () => {
  installStorage({ 10: 80, 15: 20 });
  const calls = installFetch((call) => ok(call.method === 'GET' ? { 10: 10 } : { 10: 80, 15: 20 }));
  const sync = await load();

  await sync.syncOnStart(() => {}, CONFIG);
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT']);
  assert.deepEqual(calls[1].body, { 10: 80, 15: 20 });
});

test('保存先と同じなら送らない', async () => {
  installStorage({ 10: 80 });
  const calls = installFetch(() => ok({ 10: 80 }));
  const sync = await load();

  await sync.syncOnStart(() => {}, CONFIG);
  assert.deepEqual(calls.map((c) => c.method), ['GET'], '送る必要がない');
});

test('記録が変わったときだけ画面の描き直しを頼む', async () => {
  installStorage({ 10: 80 });
  installFetch(() => ok({ 10: 80 }));
  const sync = await load();

  let redraws = 0;
  await sync.syncOnStart(() => { redraws += 1; }, CONFIG);
  assert.equal(redraws, 0);

  installStorage({ 10: 80 });
  installFetch((call) => ok(call.method === 'GET' ? { 10: 120 } : { 10: 120 }));
  const sync2 = await load();
  await sync2.syncOnStart(() => { redraws += 1; }, CONFIG);
  assert.equal(redraws, 1);
});

test('保存先が壊れた値を返しても取り込まない', async () => {
  installStorage({ 10: 50 });
  installFetch(() => ok({ 10: 'たくさん', 99: 5, 15: -3, 16: 7 }));
  const sync = await load();

  await sync.pull(CONFIG);
  assert.deepEqual(JSON.parse(localStorage.getItem('kotobuki.bests.v1')), { 10: 50, 16: 7 });
});
