// プレイの記録（1プレイ1件）と、その集計。
// アプリ側と保存先の両方から使うので、値の扱いはここ1か所に置く。
//
// 持つのは「いつ・お題・スコア」だけ。それ以上は集めない。

import { TARGETS } from '../game/config.js';

/** 1か月ぶんに入れる上限。これを超えたら古いものから捨てる（際限なく増やさないため） */
export const MAX_PER_MONTH = 2000;

/**
 * @typedef {object} PlayEntry
 * @property {number} t   プレイし終えた時刻（エポックms）。重複の判定にも使う
 * @property {number} h   その端末での「何時台か」(0-23)
 * @property {number} target
 * @property {number} score
 */

/** 外から来た1件を、信用できる形に揃える。おかしければ null */
export function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const t = Number(raw.t);
  const h = Number(raw.h);
  const target = Number(raw.target);
  const score = Number(raw.score);
  if (!Number.isInteger(t) || t <= 0) return null;
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isInteger(target) || !TARGETS.includes(target)) return null;
  if (!Number.isInteger(score) || score < 0 || score > 10000) return null;
  return { t, h, target, score };
}

export function normalizeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const entry = normalizeEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

/** 同じプレイは1件にまとめて、古い順に並べる */
export function mergeEntries(...sources) {
  const byTime = new Map();
  for (const source of sources) {
    for (const entry of normalizeEntries(source)) {
      if (!byTime.has(entry.t)) byTime.set(entry.t, entry);
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/** 保存先での置き場所を月ごとに分ける。1回の書き込みで触る量を小さく保つため */
export function monthOf(t) {
  const date = new Date(t);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 時間帯ごとの出来をまとめる。
 *
 * スコアはお題によって桁が違う（お題25は10より多く消せる）ので、そのまま平均すると
 * 「たまたま大きいお題を遊んだ時間帯」が良く見えてしまう。
 * そこで各プレイを「同じお題での自分の平均に対する比」に直してから、時間帯ごとに平均する。
 * 100 が自分の平均どおり、120 なら2割良い。
 *
 * @param {PlayEntry[]} entries
 * @returns {{hours: {hour: number, n: number, index: number, mean: number}[], total: number, best: number | null}}
 */
export function summarizeByHour(entries) {
  const clean = mergeEntries(entries);

  // お題ごとの平均
  const sums = new Map();
  for (const { target, score } of clean) {
    const current = sums.get(target) ?? { total: 0, n: 0 };
    current.total += score;
    current.n += 1;
    sums.set(target, current);
  }

  const buckets = new Map();
  for (const entry of clean) {
    const { total, n } = sums.get(entry.target);
    const average = total / n;
    const relative = average > 0 ? entry.score / average : 1;
    const bucket = buckets.get(entry.h) ?? { hour: entry.h, n: 0, relative: 0, score: 0 };
    bucket.n += 1;
    bucket.relative += relative;
    bucket.score += entry.score;
    buckets.set(entry.h, bucket);
  }

  const hours = [...buckets.values()]
    .map(({ hour, n, relative, score }) => ({
      hour,
      n,
      index: Math.round((relative / n) * 100),
      mean: Math.round((score / n) * 10) / 10,
    }))
    .sort((a, b) => a.hour - b.hour);

  return { hours, total: clean.length, best: pickBest(hours) };
}

/**
 * 一番良い時間帯。ただし1〜2回しか遊んでいない時間帯は、たまたま良かっただけのことが多いので選ばない。
 * どこも回数が足りなければ null（＝まだ言えない）。
 */
export const MIN_SAMPLES = 3;

function pickBest(hours) {
  const enough = hours.filter((hour) => hour.n >= MIN_SAMPLES);
  if (enough.length < 2) return null;   // 比べる相手がいないなら「一番」とは言わない
  return enough.reduce((best, hour) => (hour.index > best.index ? hour : best)).hour;
}
