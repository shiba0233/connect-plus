import test from 'node:test';
import assert from 'node:assert/strict';

import { Board, neighborTable, isConnectable } from '../src/game/board.js';
import { createRng } from '../src/game/rng.js';
import { COLS, ROWS, MIN_VALUE, MAX_VALUE } from '../src/game/config.js';

const at = (row, col) => row * COLS + col;

test('繋げられるセル: 中央は12セル（上下左右4 + 斜め1マス4 + 斜め2マス4）', () => {
  const table = neighborTable();
  const center = at(2, 2);
  assert.equal(table[center].length, 12);
  assert.deepEqual(
    [...table[center]].sort((a, b) => a - b),
    [at(1, 2), at(3, 2), at(2, 1), at(2, 3),
     at(1, 1), at(1, 3), at(3, 1), at(3, 3),
     at(0, 0), at(0, 4), at(4, 0), at(4, 4)].sort((a, b) => a - b),
  );
});

test('繋げられるセル: 盤面の外には出ない', () => {
  const table = neighborTable();
  assert.deepEqual([...table[at(0, 0)]].sort((a, b) => a - b), [at(0, 1), at(1, 0), at(1, 1), at(2, 2)]);
  for (const list of table) {
    assert.ok(list.length >= 3 && list.length <= 12);
    assert.equal(new Set(list).size, list.length, '重複した候補がある');
  }
});

test('繋げられるセル: 左右の端をまたがない', () => {
  // (1,4) の右隣は (1,0) ではない
  assert.equal(isConnectable(at(1, 4), at(1, 0)), false);
  assert.equal(isConnectable(at(1, 4), at(2, 0)), false);
  assert.equal(isConnectable(at(1, 4), at(0, 3)), true);
});

test('繋げられるセル: 斜め2マスは可、上下左右2マスは不可', () => {
  assert.equal(isConnectable(at(2, 2), at(0, 0)), true);   // 斜め2マス
  assert.equal(isConnectable(at(2, 2), at(0, 2)), false);  // 上へ2マス
  assert.equal(isConnectable(at(2, 2), at(2, 0)), false);  // 左へ2マス
  assert.equal(isConnectable(at(2, 2), at(0, 1)), false);  // 桂馬跳び
});

test('繋げられるセルの関係は対称', () => {
  const table = neighborTable();
  table.forEach((list, from) => {
    for (const to of list) assert.ok(table[to].includes(from), `${from} -> ${to} が片方向`);
  });
});

test('盤面: 5列6行、数字は1〜9', () => {
  const board = new Board({ rng: createRng(1) });
  assert.equal(board.cells.length, COLS * ROWS);
  for (const cell of board.cells) {
    assert.ok(Number.isInteger(cell.value));
    assert.ok(cell.value >= MIN_VALUE && cell.value <= MAX_VALUE);
  }
  assert.equal(new Set(board.cells.map((c) => c.id)).size, COLS * ROWS, 'id が重複している');
});

test('消去: 上のセルが落ちて、上端に補充される', () => {
  const board = new Board({ rng: createRng(2) });
  board.cells.forEach((cell, i) => { cell.value = i; });
  const top = board.cells[at(0, 2)];
  const mid = board.cells[at(3, 2)];

  const { removed, spawned } = board.clear([at(4, 2), at(5, 2)]);

  assert.equal(removed.length, 2);
  assert.equal(spawned.length, 2);
  assert.equal(board.cells.length, COLS * ROWS);
  // 消えた2つのぶんだけ、同じ列のセルが2行ぶん落ちる
  assert.equal(board.cells[at(2, 2)].id, top.id);
  assert.equal(board.cells[at(5, 2)].id, mid.id);
  // 補充は上端に入る
  assert.ok(spawned.includes(board.cells[at(0, 2)].id));
  assert.ok(spawned.includes(board.cells[at(1, 2)].id));
});

test('消去: 他の列は動かない', () => {
  const board = new Board({ rng: createRng(3) });
  const before = board.cells.map((cell) => cell.id);
  board.clear([at(0, 0), at(3, 0)]);
  for (let col = 1; col < COLS; col += 1) {
    for (let row = 0; row < ROWS; row += 1) {
      assert.equal(board.cells[at(row, col)].id, before[at(row, col)]);
    }
  }
});

test('消去: 列を丸ごと消しても全部補充される', () => {
  const board = new Board({ rng: createRng(4) });
  const column = Array.from({ length: ROWS }, (_, row) => at(row, 1));
  const { spawned } = board.clear(column);
  assert.equal(spawned.length, ROWS);
  assert.equal(new Set(board.cells.map((c) => c.id)).size, COLS * ROWS);
});

test('組み直し: セルの並びはそのままで数字だけ変わる', () => {
  const board = new Board({ rng: createRng(5) });
  const ids = board.cells.map((c) => c.id);
  board.randomize();
  assert.deepEqual(board.cells.map((c) => c.id), ids);
});
