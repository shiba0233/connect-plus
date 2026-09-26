import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeEntry, normalizeEntries, mergeEntries, monthOf, summarizeByHour, MIN_SAMPLES,
} from '../src/shared/log.js';

const at = (hour, target, score, day = 1) => ({
  t: Date.UTC(2026, 8, day, hour, 30),
  h: hour,
  target,
  score,
});

test('おかしな記録は受け付けない', () => {
  assert.deepEqual(normalizeEntry({ t: 1, h: 0, target: 10, score: 0 }), { t: 1, h: 0, target: 10, score: 0 });
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({ t: 0, h: 0, target: 10, score: 1 }), null, '時刻が無い');
  assert.equal(normalizeEntry({ t: 1, h: 24, target: 10, score: 1 }), null, '24時台は無い');
  assert.equal(normalizeEntry({ t: 1, h: -1, target: 10, score: 1 }), null);
  assert.equal(normalizeEntry({ t: 1, h: 0, target: 9, score: 1 }), null, 'お題の範囲外');
  assert.equal(normalizeEntry({ t: 1, h: 0, target: 10, score: -1 }), null);
  assert.equal(normalizeEntry({ t: 1.5, h: 0, target: 10, score: 1 }), null);
  assert.equal(normalizeEntry({ t: 1, h: 0, target: 10, score: 'たくさん' }), null);
});

test('余計な項目は落とす', () => {
  assert.deepEqual(
    normalizeEntry({ t: 5, h: 3, target: 12, score: 7, 端末: 'iPhone', 位置: '東京' }),
    { t: 5, h: 3, target: 12, score: 7 },
  );
});

test('配列ごと揃える。壊れた要素だけ捨てる', () => {
  assert.equal(normalizeEntries([at(1, 10, 5), null, { t: 2 }, at(2, 10, 6)]).length, 2);
  assert.deepEqual(normalizeEntries('配列ではない'), []);
});

test('同じプレイは1件にまとめ、古い順に並べる', () => {
  const a = at(10, 12, 20);
  const b = at(9, 12, 30);
  const merged = mergeEntries([a, b], [a], [b]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((e) => e.h), [9, 10], '古い順');
});

test('保存先の置き場所は月ごと', () => {
  assert.equal(monthOf(Date.UTC(2026, 0, 15)), '2026-01');
  assert.equal(monthOf(Date.UTC(2026, 11, 31)), '2026-12');
});

test('お題の違いでスコアの桁が変わっても、時間帯の比較がゆがまない', () => {
  // 22時台はお題25（大きく稼げる）、10時台はお題10（稼ぎにくい）。
  // どちらも「そのお題での自分の平均どおり」なら、指数は互角になるべき。
  const entries = [
    at(22, 25, 60, 1), at(22, 25, 60, 2), at(22, 25, 60, 3),
    at(10, 10, 20, 1), at(10, 10, 20, 2), at(10, 10, 20, 3),
  ];
  const { hours } = summarizeByHour(entries);
  assert.deepEqual(hours.map((h) => [h.hour, h.index]), [[10, 100], [22, 100]]);
});

test('同じお題での出来の差は、ちゃんと指数に出る', () => {
  const entries = [
    at(22, 15, 60, 1), at(22, 15, 60, 2), at(22, 15, 60, 3),   // 平均より上
    at(10, 15, 20, 1), at(10, 15, 20, 2), at(10, 15, 20, 3),   // 平均より下
  ];
  const { hours, best } = summarizeByHour(entries);
  const byHour = Object.fromEntries(hours.map((h) => [h.hour, h.index]));
  assert.ok(byHour[22] > 120, `22時台が高いはず: ${byHour[22]}`);
  assert.ok(byHour[10] < 80, `10時台が低いはず: ${byHour[10]}`);
  assert.equal(best, 22);
});

test('回数が少ない時間帯は「一番」に選ばない', () => {
  const entries = [
    at(3, 15, 99, 1),                                          // 1回だけ絶好調
    at(21, 15, 30, 1), at(21, 15, 30, 2), at(21, 15, 30, 3),
    at(22, 15, 40, 1), at(22, 15, 40, 2), at(22, 15, 40, 3),
  ];
  const { best, hours } = summarizeByHour(entries);
  assert.equal(best, 22, 'たまたま良かった3時台は選ばない');
  assert.equal(hours.find((h) => h.hour === 3).n, 1, '表示自体はする');
});

test('比べられるだけの記録が無ければ「一番」を出さない', () => {
  assert.equal(summarizeByHour([]).best, null);
  assert.equal(summarizeByHour([at(22, 15, 40, 1)]).best, null);
  // 3回あっても、比べる相手の時間帯が無ければ出さない
  const oneHour = [at(22, 15, 40, 1), at(22, 15, 40, 2), at(22, 15, 40, 3)];
  assert.equal(summarizeByHour(oneHour).best, null);
  assert.equal(MIN_SAMPLES, 3);
});

test('回数と平均スコアも出す', () => {
  const { hours, total } = summarizeByHour([at(9, 10, 10, 1), at(9, 10, 20, 2), at(15, 20, 33, 1)]);
  assert.equal(total, 3);
  const nine = hours.find((h) => h.hour === 9);
  assert.equal(nine.n, 2);
  assert.equal(nine.mean, 15);
});

test('記録が無くても落ちない', () => {
  assert.deepEqual(summarizeByHour([]), { hours: [], total: 0, best: null });
  assert.deepEqual(summarizeByHour('壊れている'), { hours: [], total: 0, best: null });
});
