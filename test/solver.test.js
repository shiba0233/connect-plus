import test from 'node:test';
import assert from 'node:assert/strict';

import { findChain, hasChain, isValidChain } from '../src/game/solver.js';
import { createRng, randomInt } from '../src/game/rng.js';
import { COLS, ROWS, TARGETS } from '../src/game/config.js';

const SIZE = COLS * ROWS;
const filled = (value) => new Array(SIZE).fill(value);
const at = (row, col) => row * COLS + col;

/** 指定セルだけ値を差し替えた盤面を作る。残りは成立しない大きな数字で埋める */
function boardWith(entries, background = 9) {
  const values = filled(background);
  for (const [index, value] of entries) values[index] = value;
  return values;
}

test('全部9でお題10は成立しない', () => {
  assert.equal(hasChain(filled(9), 10), false);
});

test('全部5でお題10は成立する（隣り合う2セル）', () => {
  const chain = findChain(filled(5), 10);
  assert.ok(chain);
  assert.equal(chain.length, 2);
  assert.ok(isValidChain(filled(5), 10, chain));
});

test('1セルだけでお題と一致しても成立しない', () => {
  // 全部5・お題5。2セルで10になってしまうので、どう繋いでも一致しない
  assert.equal(hasChain(filled(5), 5), false);
});

test('倍数にならない組み合わせは成立しない', () => {
  assert.equal(hasChain(filled(3), 10), false);
  assert.equal(hasChain(filled(4), 25), false);
  assert.equal(hasChain(filled(3), 9), true);
});

test('斜め2マスを使わないと成立しない盤面を見つけられる', () => {
  // (0,0)=4 と (2,2)=6 だけが小さい。両者は斜め2マスでのみ繋がる
  const values = boardWith([[at(0, 0), 4], [at(2, 2), 6]]);
  const chain = findChain(values, 10);
  assert.ok(chain, '斜め2マスのチェインを見落とした');
  assert.deepEqual([...chain].sort((a, b) => a - b), [at(0, 0), at(2, 2)]);
  assert.ok(isValidChain(values, 10, chain));
});

test('繋がっていない2セルだけでは成立しない', () => {
  // (0,0) と (0,3) は繋がらない位置
  const values = boardWith([[at(0, 0), 4], [at(0, 3), 6]]);
  assert.equal(hasChain(values, 10), false);
});

test('見つけたチェインは必ずルールを満たす', () => {
  const rng = createRng(20240101);
  for (let i = 0; i < 2000; i += 1) {
    const values = Array.from({ length: SIZE }, () => randomInt(rng, 1, 9));
    for (const target of TARGETS) {
      const chain = findChain(values, target);
      if (chain) assert.ok(isValidChain(values, target, chain), `不正なチェイン ${JSON.stringify(chain)}`);
    }
  }
});

test('探索を使い切ったら「成立しない」扱いにする（詰みを見逃さない側に倒す）', () => {
  // 盤面の最後の方にしか成立する組み合わせが無い盤面
  const values = boardWith([[at(5, 3), 1]]);   // 9 + 1 = 10 のみ成立
  assert.ok(hasChain(values, 10), '前提: 十分な探索なら見つかる');
  // 探索を打ち切ると、そこへ辿り着く前に「成立しない」と答える
  assert.equal(findChain(values, 10, { budget: 5 }), null);
});

test('総当たりと一致する（3x3盤面で全数確認）', () => {
  const cols = 3;
  const rows = 3;
  const size = cols * rows;
  const rng = createRng(99);

  // 小さい盤面なら、単純な総当たり（全ての単純パス）と突き合わせられる
  const bruteForce = (values, target) => {
    const neighborsOf = (index) => {
      const row = Math.floor(index / cols);
      const col = index % cols;
      const out = [];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1], [-2, -2], [-2, 2], [2, -2], [2, 2]]) {
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) out.push(r * cols + c);
      }
      return out;
    };
    const walk = (path, sum) => {
      if (path.length >= 2 && sum === target) return true;
      if (sum >= target) return false;
      for (const next of neighborsOf(path[path.length - 1])) {
        if (path.includes(next)) continue;
        path.push(next);
        if (walk(path, sum + values[next])) return true;
        path.pop();
      }
      return false;
    };
    for (let start = 0; start < size; start += 1) {
      if (walk([start], values[start])) return true;
    }
    return false;
  };

  for (let i = 0; i < 400; i += 1) {
    const values = Array.from({ length: size }, () => randomInt(rng, 1, 9));
    for (const target of [7, 10, 15, 20, 25]) {
      assert.equal(
        hasChain(values, target, { cols, rows }),
        bruteForce(values, target),
        `不一致: target=${target} values=${values.join(',')}`,
      );
    }
  }
});

test('チェインの検証: 重複・非隣接・1セル・合計違いを弾く', () => {
  const values = filled(5);
  assert.equal(isValidChain(values, 10, [at(0, 0), at(0, 1)]), true);
  assert.equal(isValidChain(values, 10, [at(0, 0), at(0, 0)]), false);     // 重複
  assert.equal(isValidChain(values, 10, [at(0, 0), at(0, 3)]), false);     // 繋がらない
  assert.equal(isValidChain(values, 5, [at(0, 0)]), false);                // 1セル
  assert.equal(isValidChain(values, 12, [at(0, 0), at(0, 1)]), false);     // 不足
  assert.equal(isValidChain(values, 10, [at(0, 0), at(0, 1), at(0, 2)]), false); // 超過
});
