// 端末への保存だけを見る (spec 5章)。読めなければ既定値で動かす。
// 端末の外へ預ける話は sync.js。

import { normalizeBests, mergeBests } from '../shared/bests.js';

// 保存先の名前は作り始めたときのまま。変えると既存の記録が読めなくなるので触らない。
const BEST_KEY = 'kotobuki.bests.v1';
const SETTINGS_KEY = 'kotobuki.settings.v1';

const DEFAULT_SETTINGS = { theme: 'dark' };   // 既定はダークモード (spec 6.2)
const THEMES = ['dark', 'light', 'system'];

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;   // iOS でストレージが消えていても、壊れていても動き続ける (spec 9章)
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** お題ごとの自己ベスト。履歴は持たない (spec 3.7) */
export function loadBests() {
  return normalizeBests(read(BEST_KEY));
}

/**
 * 外から来た記録を取り込む。お題ごとに高い方を採るので、取り込みで記録が下がることはない。
 * @param {{[target: number]: number}} incoming
 * @returns {{updated: number, bests: {[target: number]: number}}}
 */
export function mergeIntoBests(incoming) {
  const current = loadBests();
  const merged = mergeBests(current, incoming);
  let updated = 0;
  for (const [target, score] of Object.entries(merged)) {
    if (current[target] !== score) updated += 1;
  }
  if (updated > 0) write(BEST_KEY, merged);
  return { updated, bests: merged };
}

export function getBest(target) {
  const best = loadBests()[target];
  return Number.isInteger(best) ? best : null;
}

/**
 * ベストを更新する。更新したときだけ true。
 * @param {number} target
 * @param {number} score
 */
export function saveBest(target, score) {
  const bests = loadBests();
  const current = bests[target];
  if (Number.isInteger(current) && current >= score) return false;
  bests[target] = score;
  write(BEST_KEY, bests);
  return true;
}

/**
 * 保存領域を消さないようブラウザに頼む。
 * しばらく遊ばなかったときに消されるのを防ぐためのもので、
 * ホーム画面からアプリを削除した場合は、これを頼んでいても消える。
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function loadSettings() {
  const stored = read(SETTINGS_KEY);
  const theme = stored && THEMES.includes(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme;
  return { theme };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, { theme: THEMES.includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme });
}

export { THEMES };
