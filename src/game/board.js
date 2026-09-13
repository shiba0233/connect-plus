// 盤面。数字の並びと、消去→落下→補充だけを持つ。お題も時間も知らない。

import { COLS, ROWS, MIN_VALUE, MAX_VALUE } from './config.js';
import { randomInt } from './rng.js';

const neighborCache = new Map();

/**
 * 繋げられるセルの一覧を盤面サイズごとに作る (spec 3.2)。
 *   - 上下左右に1マス
 *   - 斜めに1マスまたは2マス（2マスは間の斜めセルを飛び越える。間のセルは何でもよい）
 * 1セルからの候補は最大12セル。
 * @param {number} cols
 * @param {number} rows
 * @returns {number[][]} index -> 繋げられる index の配列
 */
export function neighborTable(cols = COLS, rows = ROWS) {
  const key = `${cols}x${rows}`;
  const cached = neighborCache.get(key);
  if (cached) return cached;

  const offsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1],       // 上下左右1マス
    [-1, -1], [-1, 1], [1, -1], [1, 1],     // 斜め1マス
    [-2, -2], [-2, 2], [2, -2], [2, 2],     // 斜め2マス（飛び越え）
  ];

  const table = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const list = [];
      for (const [dr, dc] of offsets) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        list.push(r * cols + c);
      }
      table.push(list);
    }
  }

  neighborCache.set(key, table);
  return table;
}

/** from から to へ繋げられるか (spec 3.2) */
export function isConnectable(from, to, cols = COLS, rows = ROWS) {
  return neighborTable(cols, rows)[from].includes(to);
}

export class Board {
  /**
   * @param {object} [options]
   * @param {number} [options.cols]
   * @param {number} [options.rows]
   * @param {() => number} [options.rng]
   */
  constructor({ cols = COLS, rows = ROWS, rng = Math.random } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.size = cols * rows;
    this.neighbors = neighborTable(cols, rows);
    this.nextId = 1;
    /** @type {{id: number, value: number}[]} index 順のセル。index = row * cols + col、row 0 が一番上 */
    this.cells = [];
    for (let i = 0; i < this.size; i += 1) this.cells.push(this.createCell());
  }

  createCell() {
    return { id: this.nextId++, value: this.randomValue() };
  }

  randomValue() {
    // 数字の出現は当面すべて等確率 (spec 3.1)。重み付けするならここだけ差し替える。
    return randomInt(this.rng, MIN_VALUE, MAX_VALUE);
  }

  /** ロジック用の数字だけの配列 */
  values() {
    return this.cells.map((cell) => cell.value);
  }

  valueAt(index) {
    return this.cells[index].value;
  }

  indexOf(row, col) {
    return row * this.cols + col;
  }

  rowOf(index) {
    return Math.floor(index / this.cols);
  }

  colOf(index) {
    return index % this.cols;
  }

  isConnectable(from, to) {
    return this.neighbors[from].includes(to);
  }

  /** セルの並びはそのままに、数字だけ全て引き直す（詰み時の組み直し / spec 3.5） */
  randomize() {
    for (const cell of this.cells) cell.value = this.randomValue();
  }

  /**
   * 指定セルを消して、上のセルを落とし、上端に補充する (spec 3.4)。
   * セルの同一性（id）は落下しても保たれるので、画面側はそれを見てアニメーションできる。
   * @param {Iterable<number>} indices
   * @returns {{removed: number[], spawned: number[]}} 消えたセルの id と、補充されたセルの id
   */
  clear(indices) {
    const cleared = new Set(indices);
    const removed = [...cleared].map((index) => this.cells[index].id);
    const next = new Array(this.size);
    const spawned = [];

    for (let col = 0; col < this.cols; col += 1) {
      // 下から順に、消えなかったセルを詰める
      const survivors = [];
      for (let row = this.rows - 1; row >= 0; row -= 1) {
        const index = this.indexOf(row, col);
        if (!cleared.has(index)) survivors.push(this.cells[index]);
      }
      for (let depth = 0; depth < this.rows; depth += 1) {
        const row = this.rows - 1 - depth;
        const index = this.indexOf(row, col);
        if (depth < survivors.length) {
          next[index] = survivors[depth];
        } else {
          const cell = this.createCell();
          spawned.push(cell.id);
          next[index] = cell;
        }
      }
    }

    this.cells = next;
    return { removed, spawned };
  }
}
