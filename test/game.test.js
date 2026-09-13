import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/game.js';
import { createRng } from '../src/game/rng.js';
import { COLS, DURATION_MS } from '../src/game/config.js';

const at = (row, col) => row * COLS + col;

/** 盤面の数字を固定したゲームを作る。values は index 順 */
function gameWith(target, values, { seed = 1 } = {}) {
  const game = new Game({ target, rng: createRng(seed) });
  game.board.cells.forEach((cell, i) => { cell.value = values[i]; });
  return game.start(0);
}

/** 全部同じ数字の盤面 */
const uniform = (value) => new Array(30).fill(value);

test('開始前は操作を受け付けない', () => {
  const game = new Game({ target: 10, rng: createRng(1) });
  assert.equal(game.state, 'ready');
  assert.deepEqual(game.beginChain(0), { type: 'ignored' });
  assert.equal(game.remainingMs(0), DURATION_MS);
});

test('ぴったり一致したら成立して消える', () => {
  const game = gameWith(10, uniform(5));
  assert.equal(game.beginChain(at(0, 0)).type, 'started');
  const result = game.extendChain(at(0, 1));
  assert.equal(result.type, 'cleared');
  assert.deepEqual(result.cells, [at(0, 0), at(0, 1)]);
  assert.equal(result.gained, 2);
  assert.equal(game.score, 2);
  assert.equal(game.chain.length, 0);
});

test('スコアは成立回数ではなく消したセルの総数', () => {
  const values = uniform(9);
  // 1 + 2 + 3 + 4 = 10 の4セルチェインを仕込む
  values[at(0, 0)] = 1;
  values[at(0, 1)] = 2;
  values[at(1, 1)] = 3;
  values[at(1, 2)] = 4;
  const game = gameWith(10, values);
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  game.extendChain(at(1, 1));
  const result = game.extendChain(at(1, 2));
  assert.equal(result.type, 'cleared');
  assert.equal(game.score, 4, '4セル消したら4点');
});

test('超過するセルへは繋げられない', () => {
  const values = uniform(9);
  values[at(0, 0)] = 8;
  const game = gameWith(10, values);
  game.beginChain(at(0, 0));
  const result = game.extendChain(at(0, 1));   // 8 + 9 = 17 > 10
  assert.equal(result.type, 'rejected');
  assert.deepEqual(game.chain, [at(0, 0)]);
  assert.equal(game.chainSum, 8);
});

test('繋げられない位置のセルは弾かれる', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  assert.equal(game.extendChain(at(0, 3)).type, 'rejected');     // 遠すぎる
  assert.equal(game.extendChain(at(0, 2)).type, 'rejected');     // 横2マス
  assert.equal(game.extendChain(at(2, 2)).type, 'cleared');      // 斜め2マスは繋がる
});

test('斜め2マスは間のセルを消費しない', () => {
  const values = uniform(9);
  values[at(0, 0)] = 4;
  values[at(1, 1)] = 7;   // 間のセル。4 + 7 = 11 で超過するので繋げられない
  values[at(2, 2)] = 6;
  const game = gameWith(10, values);
  game.beginChain(at(0, 0));
  assert.equal(game.extendChain(at(1, 1)).type, 'rejected', '間のセルは超過するので拒否される');
  const result = game.extendChain(at(2, 2));
  assert.equal(result.type, 'cleared');
  assert.deepEqual(result.cells, [at(0, 0), at(2, 2)], '間のセルは消えない');
});

test('同じセルは1チェイン内で1回まで', () => {
  const values = uniform(1);
  const game = gameWith(10, values);
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  game.extendChain(at(1, 1));
  assert.equal(game.extendChain(at(0, 0)).type, 'rejected');
  assert.equal(game.chain.length, 3);
});

test('直前のセルへ戻ると、そのセルがチェインから外れる', () => {
  const game = gameWith(25, uniform(4));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  game.extendChain(at(0, 2));
  assert.equal(game.chainSum, 12);
  const result = game.extendChain(at(0, 1));
  assert.equal(result.type, 'removed');
  assert.deepEqual(game.chain, [at(0, 0), at(0, 1)]);
  assert.equal(game.chainSum, 8);
});

test('不足のまま指を離しても、解除されるだけでペナルティは無い', () => {
  const game = gameWith(25, uniform(4));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  assert.equal(game.endChain().type, 'released');
  assert.equal(game.score, 0);
  assert.equal(game.chain.length, 0);
  assert.equal(game.state, 'playing');
});

test('1セルでお題と一致しても成立しない', () => {
  const values = uniform(9);
  values[at(0, 0)] = 10;   // ルール上は出ない数字だが、2セル未満で成立しないことの確認
  const game = gameWith(10, values);
  assert.equal(game.beginChain(at(0, 0)).type, 'started');
  assert.equal(game.score, 0);
  assert.equal(game.chain.length, 1);
});

test('成立した直後は、指を離すまで次のチェインを始めない', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  assert.deepEqual(game.beginChain(at(3, 3)), { type: 'ignored' });
  assert.equal(game.endChain().type, 'unlocked');
  assert.equal(game.beginChain(at(3, 3)).type, 'started');
});

test('消えたあとは補充されて、常に成立可能な盤面が保たれる', () => {
  const game = gameWith(10, uniform(5));
  for (let i = 0; i < 50; i += 1) {
    const start = game.board.values().findIndex((_, index) => {
      const from = index;
      return game.board.neighbors[from].some((to) => game.board.valueAt(from) + game.board.valueAt(to) === 10);
    });
    if (start < 0) break;
    game.beginChain(start);
    const to = game.board.neighbors[start].find((index) => game.board.valueAt(start) + game.board.valueAt(index) === 10);
    const result = game.extendChain(to);
    assert.equal(result.type, 'cleared');
    assert.equal(game.board.cells.length, 30, '補充されていない');
    game.endChain();
  }
  assert.ok(game.score >= 2);
});

test('時間切れでセッションが終わり、操作を受け付けなくなる', () => {
  const game = gameWith(10, uniform(5));
  assert.equal(game.update(DURATION_MS - 1), 'playing');
  assert.equal(game.remainingMs(DURATION_MS - 1), 1);
  assert.equal(game.update(DURATION_MS), 'over');
  assert.equal(game.remainingMs(DURATION_MS + 5000), 0);
  assert.deepEqual(game.beginChain(at(0, 0)), { type: 'ignored' });
});

test('時間切れの瞬間になぞっていたチェインは成立しない', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.update(DURATION_MS);
  assert.equal(game.chain.length, 0);
  assert.deepEqual(game.extendChain(at(0, 1)), { type: 'ignored' });
  assert.equal(game.score, 0);
});

test('中断するとその場で終わる', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.abort();
  assert.equal(game.state, 'over');
  assert.equal(game.chain.length, 0);
});
