import test from 'node:test';
import assert from 'node:assert/strict';

import { Board } from '../src/game/board.js';
import { createSolvableBoard, ensureSolvable, plantChain } from '../src/game/generator.js';
import { hasChain, isValidChain } from '../src/game/solver.js';
import { createRng } from '../src/game/rng.js';
import { TARGETS, COLS, ROWS, MIN_VALUE, MAX_VALUE } from '../src/game/config.js';

test('生成した盤面は必ず成立可能', () => {
  for (const target of TARGETS) {
    for (let seed = 0; seed < 200; seed += 1) {
      const board = createSolvableBoard(target, { rng: createRng(seed * 131 + target) });
      assert.ok(hasChain(board.values(), target), `target=${target} seed=${seed} が詰んでいる`);
    }
  }
});

test('詰んだ盤面は組み直される', () => {
  // 全部同じ数字 v の盤面は、お題が v の倍数でなければ必ず詰んでいる。
  // （お題18に対する9のように、割り切れる組み合わせは避ける）
  const deadValue = (target) => [MAX_VALUE, 8, 7].find((v) => target % v !== 0);

  for (const target of TARGETS) {
    const rng = createRng(target);
    const board = new Board({ rng });
    const value = deadValue(target);
    board.cells.forEach((cell) => { cell.value = value; });
    assert.equal(hasChain(board.values(), target), false, `前提: お題${target} / 全部${value} は詰んでいる`);
    assert.equal(ensureSolvable(board, target, rng), true, '組み直されなかった');
    assert.ok(hasChain(board.values(), target), `お題${target} が組み直しても詰んだまま`);
  }
});

test('成立可能な盤面は組み直さない', () => {
  const rng = createRng(42);
  const board = createSolvableBoard(15, { rng });
  const before = board.values();
  assert.equal(ensureSolvable(board, 15, rng), false);
  assert.deepEqual(board.values(), before);
});

test('埋め込んだチェインはルールを満たし、数字は1〜9に収まる', () => {
  for (const target of TARGETS) {
    for (let seed = 0; seed < 100; seed += 1) {
      const rng = createRng(seed * 17 + target);
      const board = new Board({ rng });
      const path = plantChain(board, target, rng);
      assert.ok(isValidChain(board.values(), target, path), `target=${target} seed=${seed}`);
      for (const cell of board.cells) {
        assert.ok(cell.value >= MIN_VALUE && cell.value <= MAX_VALUE);
      }
    }
  }
});

test('組み直してもセルの数は変わらない', () => {
  const rng = createRng(7);
  const board = createSolvableBoard(25, { rng });
  assert.equal(board.cells.length, COLS * ROWS);
  assert.equal(new Set(board.cells.map((c) => c.id)).size, COLS * ROWS);
});
