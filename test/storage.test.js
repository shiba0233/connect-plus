import test from 'node:test';
import assert from 'node:assert/strict';

/** ブラウザの localStorage の代わり。壊れた値や書き込み失敗も試せるようにしておく */
function installStorage({ failWrites = false } = {}) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) throw new Error('QuotaExceededError');
      data.set(key, String(value));
    },
    removeItem: (key) => data.delete(key),
  };
  return data;
}

/** localStorage を差し替えてから読み込む */
async function loadModule() {
  return import(`../src/app/storage.js?${Math.random()}`);
}

test('ベストはお題ごとに独立して記録される', async () => {
  installStorage();
  const storage = await loadModule();

  assert.equal(storage.getBest(10), null, '未プレイなら null');
  assert.equal(storage.saveBest(10, 32), true);
  assert.equal(storage.saveBest(15, 8), true);
  assert.equal(storage.getBest(10), 32);
  assert.equal(storage.getBest(15), 8);
  assert.equal(storage.getBest(20), null);
});

test('更新したときだけ true を返し、下回るスコアでは書き換えない', async () => {
  installStorage();
  const storage = await loadModule();

  assert.equal(storage.saveBest(25, 12), true);
  assert.equal(storage.saveBest(25, 12), false, '同点は更新ではない');
  assert.equal(storage.saveBest(25, 11), false);
  assert.equal(storage.getBest(25), 12);
  assert.equal(storage.saveBest(25, 13), true);
  assert.equal(storage.getBest(25), 13);
});

test('0点でも記録は残る', async () => {
  installStorage();
  const storage = await loadModule();
  assert.equal(storage.saveBest(20, 0), true);
  assert.equal(storage.getBest(20), 0, '未プレイ (null) と 0点は別');
});

test('壊れた値が入っていても既定値で動く', async () => {
  const data = installStorage();
  data.set('kotobuki.bests.v1', '{壊れている');
  data.set('kotobuki.settings.v1', '[]');
  const storage = await loadModule();

  assert.deepEqual(storage.loadBests(), {});
  assert.deepEqual(storage.loadSettings(), { theme: 'dark' });
});

test('数字でないベストは読み捨てる', async () => {
  const data = installStorage();
  data.set('kotobuki.bests.v1', JSON.stringify({ 10: 'たくさん', 15: -3, 20: 7 }));
  const storage = await loadModule();
  assert.deepEqual(storage.loadBests(), { 20: 7 });
});

test('テーマは既定でダーク。知らない値は受け付けない', async () => {
  installStorage();
  const storage = await loadModule();

  assert.deepEqual(storage.loadSettings(), { theme: 'dark' });
  storage.saveSettings({ theme: 'light' });
  assert.deepEqual(storage.loadSettings(), { theme: 'light' });
  storage.saveSettings({ theme: 'まぶしい' });
  assert.deepEqual(storage.loadSettings(), { theme: 'dark' });
});

test('保存できない環境でも落ちない', async () => {
  installStorage({ failWrites: true });
  const storage = await loadModule();

  assert.doesNotThrow(() => storage.saveBest(10, 5));
  assert.doesNotThrow(() => storage.saveSettings({ theme: 'light' }));
  assert.equal(storage.getBest(10), null);
});

test('localStorage が無くても読み書きできる（消えても動く）', async () => {
  delete globalThis.localStorage;
  const storage = await loadModule();

  assert.deepEqual(storage.loadBests(), {});
  assert.deepEqual(storage.loadSettings(), { theme: 'dark' });
  assert.doesNotThrow(() => storage.saveBest(10, 5));
});
