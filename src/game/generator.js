// 盤面の生成と、詰んだときの組み直し (spec 3.5)。
// 「成立可能な配置を保証する」ことだけが仕事。

import { MIN_VALUE, MAX_VALUE } from './config.js';
import { Board } from './board.js';
import { hasChain } from './solver.js';
import { randomInt } from './rng.js';

/** 組み直しを諦めて、成立するチェインを直接埋め込むまでの試行回数 */
const RESHUFFLE_ATTEMPTS = 20;
/** 埋め込むチェインの最大の長さ。長すぎると盤面上を這わせるのに失敗しやすい */
const MAX_PLANTED_LENGTH = 6;

/**
 * 成立可能な組み合わせが無ければ、盤面全体の数字を組み直す (spec 3.5)。
 * 何度か引き直して駄目なら、成立するチェインを直接埋め込んで必ず終わらせる。
 * @param {Board} board
 * @param {number} target
 * @param {() => number} rng
 * @returns {boolean} 組み直したら true
 */
export function ensureSolvable(board, target, rng = board.rng) {
  if (hasChain(board.values(), target, { cols: board.cols, rows: board.rows })) return false;

  for (let attempt = 0; attempt < RESHUFFLE_ATTEMPTS; attempt += 1) {
    board.randomize();
    if (hasChain(board.values(), target, { cols: board.cols, rows: board.rows })) return true;
  }

  plantChain(board, target, rng);
  return true;
}

/** 成立可能な盤面を作る */
export function createSolvableBoard(target, { cols, rows, rng = Math.random } = {}) {
  const board = new Board({ cols, rows, rng });
  ensureSolvable(board, target, rng);
  return board;
}

/**
 * 盤面のどこかに、合計がちょうど target になるチェインを1本書き込む。
 * 繋がったセルを歩いて、そこへ target を分け合う数字を置く。
 * @param {Board} board
 * @param {number} target
 * @param {() => number} rng
 * @returns {number[]} 書き込んだセルの index
 */
export function plantChain(board, target, rng = board.rng) {
  const minLength = Math.max(2, Math.ceil(target / MAX_VALUE));
  const maxLength = Math.min(target, MAX_PLANTED_LENGTH);
  if (minLength > maxLength) {
    throw new Error(`お題 ${target} は ${board.size} セルの盤面に配置できない`);
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const length = randomInt(rng, minLength, maxLength);
    const path = randomWalk(board, length, rng);
    if (!path) continue;
    const parts = splitValue(target, length, rng);
    path.forEach((index, i) => {
      board.cells[index].value = parts[i];
    });
    return path;
  }

  throw new Error('チェインを配置できる経路が見つからない');
}

/** 繋がったセルを length 個ぶん、重複なしで歩く */
function randomWalk(board, length, rng) {
  const start = randomInt(rng, 0, board.size - 1);
  const path = [start];
  const used = new Set(path);

  while (path.length < length) {
    const candidates = board.neighbors[path[path.length - 1]].filter((index) => !used.has(index));
    if (candidates.length === 0) return null;
    const next = candidates[Math.floor(rng() * candidates.length)];
    path.push(next);
    used.add(next);
  }

  return path;
}

/** total を count 個の 1〜9 に分ける */
function splitValue(total, count, rng) {
  const parts = new Array(count).fill(MIN_VALUE);
  let rest = total - MIN_VALUE * count;
  while (rest > 0) {
    const i = randomInt(rng, 0, count - 1);
    if (parts[i] >= MAX_VALUE) continue;
    const add = Math.min(rest, randomInt(rng, 1, MAX_VALUE - parts[i]));
    parts[i] += add;
    rest -= add;
  }
  return parts;
}
