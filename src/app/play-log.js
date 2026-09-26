// プレイの記録を残す。端末にも持ち、保存先にも送る。
// 記録が無いと時間帯の傾向は出せないので、成立したセッションは毎回1件残す。
// 中断したセッションは記録しない (spec 4.2)。

import { mergeEntries, normalizeEntries } from '../shared/log.js';
import { SYNC_URL, SYNC_KEY } from './sync-config.js';

const LOG_KEY = 'kotobuki.log.v1';
const UNSENT_KEY = 'kotobuki.log.unsent.v1';
/** 端末に持っておく上限。古いものから落とす */
const MAX_LOCAL = 5000;
const TIMEOUT_MS = 8000;

const isConfigured = () => Boolean(SYNC_URL);
const endpoint = () => `${SYNC_URL.replace(/\/+$/, '')}/log/${SYNC_KEY}`;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]');
  } catch {
    return [];
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 保存できなくても遊べる */ }
}

/** 端末に残っている全件 */
export function loadLocal() {
  return mergeEntries(read(LOG_KEY));
}

/**
 * 1プレイぶんを記録して、保存先へ送る。送信は待たない。
 * @param {{target: number, score: number, now?: number}} play
 */
export function record({ target, score, now = Date.now() }) {
  const date = new Date(now);
  const entry = { t: now, h: date.getHours(), target, score };

  write(LOG_KEY, mergeEntries(loadLocal(), [entry]).slice(-MAX_LOCAL));
  write(UNSENT_KEY, mergeEntries(read(UNSENT_KEY), [entry]));
  flush();
  return entry;
}

/** まだ送れていないぶんを送る。送れなければ次の機会に持ち越す */
export async function flush() {
  if (!isConfigured()) return false;
  const unsent = mergeEntries(read(UNSENT_KEY));
  if (unsent.length === 0) return true;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(unsent),
    });
    if (!response.ok) return false;
    // 送っている間に増えたぶんは残す
    const still = mergeEntries(read(UNSENT_KEY)).filter((entry) => !unsent.some((sent) => sent.t === entry.t));
    write(UNSENT_KEY, still);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 表示用に全件そろえる。端末のぶんをすぐ返し、保存先のぶんは取れたら足す。
 * @param {(entries: object[]) => void} onUpdated 保存先のぶんが増えたときに呼ぶ
 * @returns {object[]} 端末にあるぶん
 */
export function loadAll(onUpdated) {
  const local = loadLocal();
  if (!isConfigured()) return local;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  fetch(endpoint(), { signal: controller.signal, cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((remote) => {
      if (!remote) return;
      const merged = mergeEntries(local, normalizeEntries(remote));
      if (merged.length === local.length) return;
      write(LOG_KEY, merged.slice(-MAX_LOCAL));
      onUpdated?.(merged);
    })
    .catch(() => { /* 圏外なら端末のぶんだけで見る */ })
    .finally(() => clearTimeout(timer));

  return local;
}
