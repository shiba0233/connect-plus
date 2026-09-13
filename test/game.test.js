import test from 'node:test';
import assert from 'node:assert/strict';

import { Game } from '../src/game/game.js';
import { createRng } from '../src/game/rng.js';
import { COLS, ROWS, DURATION_MS } from '../src/game/config.js';

const SIZE = COLS * ROWS;
const at = (row, col) => row * COLS + col;

/** 盤面の数字を固定したゲームを作る。values は index 順 */
function gameWith(target, values, { seed = 1 } = {}) {
  const game = new Game({ target, rng: createRng(seed) });
  game.board.cells.forEach((cell, i) => { cell.value = values[i]; });
  return game.start(0);
}

/** 全部同じ数字の盤面 */
const uniform = (value) => new Array(SIZE).fill(value);

/** なぞって指を離すまでを一度に行う */
function trace(game, chain) {
  game.beginChain(chain[0]);
  for (const index of chain.slice(1)) game.extendChain(index);
  return game.endChain();
}

test('開始前は操作を受け付けない', () => {
  const game = new Game({ target: 10, rng: createRng(1) });
  assert.equal(game.state, 'ready');
  assert.deepEqual(game.beginChain(0), { type: 'ignored' });
  assert.equal(game.remainingMs(0), DURATION_MS);
});

test('制限時間は90秒', () => {
  assert.equal(DURATION_MS, 90_000);
});

test('ぴったり一致しただけでは消えない。指を離して消える', () => {
  const game = gameWith(10, uniform(5));
  assert.equal(game.beginChain(at(0, 0)).type, 'started');

  const added = game.extendChain(at(0, 1));
  assert.equal(added.type, 'added', '一致した瞬間に消えてはいけない');
  assert.equal(game.isComplete, true);
  assert.equal(game.score, 0, 'まだ点は入らない');
  assert.deepEqual(game.chain, [at(0, 0), at(0, 1)]);

  const released = game.endChain();
  assert.equal(released.type, 'cleared');
  assert.deepEqual(released.cells, [at(0, 0), at(0, 1)]);
  assert.equal(game.score, 2);
  assert.equal(game.chain.length, 0);
});

test('一致したあとで戻せば、点は入らない', () => {
  // 5+5 で10ちょうど。そこから戻して別の繋ぎ方に変えられる
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  assert.equal(game.isComplete, true);

  const removed = game.extendChain(at(0, 0));   // 直前のセルへ戻る
  assert.equal(removed.type, 'removed');
  assert.equal(game.isComplete, false);

  assert.equal(game.endChain().type, 'released');
  assert.equal(game.score, 0, '戻したので点は入らない');
  assert.equal(game.board.cells.length, SIZE, '盤面も減っていない');
});

test('一致したチェインは伸ばせない（どのセルを足しても超過する）', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  assert.equal(game.extendChain(at(1, 1)).type, 'rejected');
  assert.equal(game.chainSum, 10);
});

test('スコアは成立回数ではなく消したセルの総数', () => {
  const values = uniform(9);
  values[at(0, 0)] = 1;
  values[at(0, 1)] = 2;
  values[at(1, 1)] = 3;
  values[at(1, 2)] = 4;
  const game = gameWith(10, values);
  const result = trace(game, [at(0, 0), at(0, 1), at(1, 1), at(1, 2)]);
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
  assert.equal(game.extendChain(at(3, 0)).type, 'rejected');     // 縦に3マス
  assert.equal(game.extendChain(at(0, 2)).type, 'rejected');     // 横2マス
  assert.equal(game.extendChain(at(2, 2)).type, 'added');        // 斜め2マスは繋がる
});

test('斜め2マスは間のセルを消費しない', () => {
  const values = uniform(9);
  values[at(0, 0)] = 4;
  values[at(1, 1)] = 7;   // 間のセル。4 + 7 = 11 で超過するので繋げられない
  values[at(2, 2)] = 6;
  const game = gameWith(10, values);
  game.beginChain(at(0, 0));
  assert.equal(game.extendChain(at(1, 1)).type, 'rejected', '間のセルは超過するので拒否される');
  game.extendChain(at(2, 2));
  const result = game.endChain();
  assert.equal(result.type, 'cleared');
  assert.deepEqual(result.cells, [at(0, 0), at(2, 2)], '間のセルは消えない');
});

test('同じセルは1チェイン内で1回まで', () => {
  const game = gameWith(10, uniform(1));
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
  assert.equal(game.isComplete, false);
  assert.equal(game.endChain().type, 'released');
  assert.equal(game.score, 0);
});

test('消したあとすぐ次のチェインを始められる', () => {
  const game = gameWith(10, uniform(5));
  assert.equal(trace(game, [at(0, 0), at(0, 1)]).type, 'cleared');
  assert.equal(game.beginChain(at(2, 2)).type, 'started', '指を離したあとは即座に次を始められる');
});

test('消えたあとは補充されて、常に成立可能な盤面が保たれる', () => {
  const game = gameWith(10, uniform(5));
  for (let i = 0; i < 50; i += 1) {
    const start = game.board.cells.findIndex((_, index) =>
      game.board.neighbors[index].some((to) => game.board.valueAt(index) + game.board.valueAt(to) === 10));
    if (start < 0) break;
    const to = game.board.neighbors[start].find((index) => game.board.valueAt(start) + game.board.valueAt(index) === 10);
    assert.equal(trace(game, [start, to]).type, 'cleared');
    assert.equal(game.board.cells.length, SIZE, '補充されていない');
    for (const cell of game.board.cells) {
      assert.ok(cell.value >= 1 && cell.value <= 9, `範囲外の数字 ${cell.value}`);
    }
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

test('時間切れの瞬間に一致していたチェインも成立しない', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.extendChain(at(0, 1));
  assert.equal(game.isComplete, true);
  game.update(DURATION_MS);
  assert.equal(game.chain.length, 0);
  assert.equal(game.endChain().type, 'released');
  assert.equal(game.score, 0);
});

test('中断するとその場で終わる', () => {
  const game = gameWith(10, uniform(5));
  game.beginChain(at(0, 0));
  game.abort();
  assert.equal(game.state, 'over');
  assert.equal(game.chain.length, 0);
});

test('盤面は4列5行', () => {
  assert.equal(COLS, 4);
  assert.equal(ROWS, 5);
  const game = new Game({ target: 15, rng: createRng(3) });
  assert.equal(game.board.cells.length, 20);
});
