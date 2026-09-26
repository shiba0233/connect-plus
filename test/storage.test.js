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

// ---------------------------------------------------------------- 記録の控え

test('書き出して読み込むと、記録がそのまま戻る', async () => {
  installStorage();
  const storage = await loadModule();

  storage.saveBest(10, 48);
  storage.saveBest(15, 32);
  storage.saveBest(20, 0);
  const code = storage.exportBests();
  assert.equal(code, 'tashizan1:10=48,15=32,20=0');

  installStorage();                       // 端末を変えた／アプリを消した状態
  const fresh = await loadModule();
  assert.deepEqual(fresh.loadBests(), {});

  const result = fresh.importBests(code);
  assert.deepEqual(result, { ok: true, updated: 3, total: 3 });
  assert.deepEqual(fresh.loadBests(), { 10: 48, 15: 32, 20: 0 });
});

test('読み込みで記録が下がることはない', async () => {
  installStorage();
  const storage = await loadModule();

  storage.saveBest(10, 99);
  storage.saveBest(11, 5);
  const result = storage.importBests('tashizan1:10=48,11=60,12=7');
  assert.equal(result.ok, true);
  assert.equal(result.updated, 2, '上がるものだけ数える');
  assert.equal(storage.getBest(10), 99, '高い方が残る');
  assert.equal(storage.getBest(11), 60);
  assert.equal(storage.getBest(12), 7);
});

test('記録が無くても書き出せる', async () => {
  installStorage();
  const storage = await loadModule();
  assert.equal(storage.exportBests(), 'tashizan1:');
  assert.equal(storage.importBests('tashizan1:').ok, false);
});

test('目印が無くても読める。改行や空白が混ざっても読める', async () => {
  installStorage();
  const storage = await loadModule();
  assert.equal(storage.importBests(' 10=48,\n15=32 ').ok, true);
  assert.deepEqual(storage.loadBests(), { 10: 48, 15: 32 });
});

test('おかしな文字列は読み込まない', async () => {
  installStorage();
  const storage = await loadModule();
  storage.saveBest(10, 7);

  for (const bad of ['あいうえお', 'tashizan1:10', '10=abc', '10=1,こわれ', '', '   ']) {
    assert.equal(storage.importBests(bad).ok, false, `読めてしまった: ${bad}`);
  }
  assert.equal(storage.importBests('9=50').ok, false, 'お題の範囲外');
  assert.equal(storage.importBests('26=50').ok, false, 'お題の範囲外');
  assert.deepEqual(storage.loadBests(), { 10: 7 }, '失敗しても元の記録は壊れない');
});

test('保存できない環境でも書き出し・読み込みで落ちない', async () => {
  installStorage({ failWrites: true });
  const storage = await loadModule();
  assert.doesNotThrow(() => storage.exportBests());
  assert.doesNotThrow(() => storage.importBests('tashizan1:10=48'));
});

test('storage API が無くても保存の永続化要求で落ちない', async () => {
  installStorage();
  const storage = await loadModule();
  delete globalThis.navigator;
  assert.equal(await storage.requestPersistence(), false);
});
