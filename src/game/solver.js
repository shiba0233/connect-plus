// 成立可能な組み合わせが盤面に存在するかの判定 (spec 3.5)。
// 補充のたびに呼ばれるので、速さと「詰みを見落とさないこと」の両方が要る。

import { COLS, ROWS, MIN_CHAIN_LENGTH } from './config.js';
import { neighborTable } from './board.js';

/** 探索の上限。これを超えたら「見つからなかった」扱いにする（理由は findChain のコメント参照） */
export const DEFAULT_BUDGET = 200_000;

/**
 * 合計がちょうど target になるチェインを1つ探す。
 *
 * 深さ優先探索。合計が target を超えた枝はその場で切り、
 * 「この (最後のセル, 使用済みセルの集合) からは成立しない」を記憶して二度と辿らない。
 * 使用済みセルの集合は 30 セル = 30bit のビットマスクで持つ。
 *
 * 探索数が budget を超えた場合は null を返す（＝呼び出し側は詰み扱いにして組み直す）。
 * 遊べる盤面をたまに組み直してしまうことはあっても、詰んだ盤面を見逃すよりは害が小さい。
 *
 * @param {number[]} values セルの数字（index 順）
 * @param {number} target お題
 * @param {object} [options]
 * @param {number} [options.cols]
 * @param {number} [options.rows]
 * @param {number} [options.budget]
 * @returns {number[] | null} 成立するチェインの index 配列。無ければ null
 */
export function findChain(values, target, { cols = COLS, rows = ROWS, budget = DEFAULT_BUDGET } = {}) {
  const neighbors = neighborTable(cols, rows);
  const size = cols * rows;
  const dead = new Set();
  const path = [];
  let steps = 0;
  let exhausted = false;

  const search = (last, mask, sum) => {
    if (steps++ > budget) {
      exhausted = true;
      return false;
    }
    for (const next of neighbors[last]) {
      if (mask & (1 << next)) continue;               // 同じセルは1チェイン内で1回まで
      const nextSum = sum + values[next];
      if (nextSum > target) continue;                 // 超過するセルへは繋げられない
      path.push(next);
      // ここに来た時点でチェインは2セル以上になっている
      if (nextSum === target) return true;
      const nextMask = mask | (1 << next);
      const key = nextMask * 32 + next;
      if (!dead.has(key)) {
        if (search(next, nextMask, nextSum)) return true;
        if (exhausted) return false;
        dead.add(key);
      }
      path.pop();
    }
    return false;
  };

  for (let start = 0; start < size; start += 1) {
    const sum = values[start];
    if (sum > target) continue;
    // 1セルだけでお題と一致しても成立しない (spec 3.3) ので、ここでは成立判定しない
    path.length = 0;
    path.push(start);
    if (search(start, 1 << start, sum)) return path.slice();
    if (exhausted) return null;
  }

  return null;
}

/** 成立可能な組み合わせが存在するか (spec 3.5) */
export function hasChain(values, target, options) {
  return findChain(values, target, options) !== null;
}

/**
 * チェインとして成立しているかの検証。
 * 繋がり・重複なし・2セル以上・合計一致をまとめて確認する。ロジックのテストと、
 * 組み直し後の自己チェックに使う。
 */
export function isValidChain(values, target, chain, { cols = COLS, rows = ROWS } = {}) {
  if (!Array.isArray(chain) || chain.length < MIN_CHAIN_LENGTH) return false;
  const neighbors = neighborTable(cols, rows);
  const seen = new Set();
  let sum = 0;
  for (let i = 0; i < chain.length; i += 1) {
    const index = chain[i];
    if (!Number.isInteger(index) || index < 0 || index >= cols * rows) return false;
    if (seen.has(index)) return false;
    seen.add(index);
    if (i > 0 && !neighbors[chain[i - 1]].includes(index)) return false;
    sum += values[index];
    if (sum > target) return false;
  }
  return sum === target;
}
