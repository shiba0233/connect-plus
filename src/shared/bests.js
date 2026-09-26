// 自己ベストの値そのものの扱い。アプリ側と保存先（Cloudflare Worker）の両方から使う。
// 判定がずれると記録が壊れるので、定義はここ1か所だけにする。

import { TARGETS } from '../game/config.js';

/**
 * 外から来た値を、信用できる形に揃える。
 * お題として存在しないキーや、数でない値、負の数は捨てる。
 * @param {unknown} raw
 * @returns {{[target: number]: number}}
 */
export function normalizeBests(raw) {
  const bests = {};
  if (!raw || typeof raw !== 'object') return bests;
  for (const [key, value] of Object.entries(raw)) {
    const target = Number(key);
    const score = Number(value);
    if (!Number.isInteger(target) || !TARGETS.includes(target)) continue;
    if (!Number.isInteger(score) || score < 0) continue;
    bests[target] = score;
  }
  return bests;
}

/**
 * 複数の記録を、お題ごとに高い方を採って1つにする。
 * どちら向きに合わせても記録が下がらないので、端末と保存先のどちらが古くても壊れない。
 * @param {...{[target: number]: number}} sources
 */
export function mergeBests(...sources) {
  const merged = {};
  for (const source of sources) {
    for (const [key, score] of Object.entries(normalizeBests(source))) {
      const target = Number(key);
      if (!Number.isInteger(merged[target]) || merged[target] < score) merged[target] = score;
    }
  }
  return merged;
}

/** 中身が同じか（送る必要があるかの判定に使う） */
export function sameBests(a, b) {
  const left = normalizeBests(a);
  const right = normalizeBests(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
