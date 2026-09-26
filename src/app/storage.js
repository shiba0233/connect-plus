// ローカル保存だけ (spec 5章)。サーバーもアカウントも持たない。
// データが消えても致命的ではない前提。読めなければ既定値で動かす。
//
// ただし「消えても平気」と「消えたら悲しい」は別なので、記録を1行の文字列として
// 書き出し／読み込みできるようにしてある。控えておけば自分で戻せる。

import { TARGETS } from '../game/config.js';

// 保存先の名前は作り始めたときのまま。変えると既存の記録が読めなくなるので触らない。
const BEST_KEY = 'kotobuki.bests.v1';
const SETTINGS_KEY = 'kotobuki.settings.v1';

/** 書き出した記録の目印。読み込むときに、それらしい文字列かどうかの確認に使う */
const BACKUP_PREFIX = 'tashizan1:';

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
  const stored = read(BEST_KEY);
  const bests = {};
  if (stored && typeof stored === 'object') {
    for (const [target, score] of Object.entries(stored)) {
      const t = Number(target);
      if (Number.isInteger(t) && Number.isInteger(score) && score >= 0) bests[t] = score;
    }
  }
  return bests;
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
 * 記録を1行の文字列にする。メモや自分宛のメッセージに控えておけば、
 * 端末を変えても、アプリを消してしまっても戻せる。
 * @returns {string} 例: "tashizan1:10=48,15=32"
 */
export function exportBests() {
  const bests = loadBests();
  const body = Object.keys(bests)
    .map(Number)
    .sort((a, b) => a - b)
    .map((target) => `${target}=${bests[target]}`)
    .join(',');
  return BACKUP_PREFIX + body;
}

/**
 * 書き出した文字列から記録を戻す。
 * 今ある記録とは高い方を採る。読み込みで記録が下がることはない。
 * @param {string} code
 * @returns {{ok: boolean, updated: number, total: number, reason?: string}}
 */
export function importBests(code) {
  const text = String(code ?? '').trim();
  if (!text) return { ok: false, updated: 0, total: 0, reason: 'empty' };

  const body = text.startsWith(BACKUP_PREFIX) ? text.slice(BACKUP_PREFIX.length) : text;
  const entries = [];
  for (const part of body.split(/[,\s]+/)) {
    if (!part) continue;
    const match = /^(\d+)[=:](\d+)$/.exec(part);
    if (!match) return { ok: false, updated: 0, total: 0, reason: 'format' };
    const target = Number(match[1]);
    const score = Number(match[2]);
    if (!TARGETS.includes(target)) return { ok: false, updated: 0, total: 0, reason: 'target' };
    entries.push([target, score]);
  }
  if (entries.length === 0) return { ok: false, updated: 0, total: 0, reason: 'empty' };

  const bests = loadBests();
  let updated = 0;
  for (const [target, score] of entries) {
    const current = bests[target];
    if (Number.isInteger(current) && current >= score) continue;
    bests[target] = score;
    updated += 1;
  }
  if (updated > 0) write(BEST_KEY, bests);
  return { ok: true, updated, total: entries.length };
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
