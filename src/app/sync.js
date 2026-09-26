// 記録を保存先に預ける。プレイヤーは何もしなくてよい。
//
// 方針:
//   - 起動時に取りに行き、端末の記録と合わせる（高い方を採る）
//   - セッションが終わるたびに送る
//   - 通信できなくても遊べる。失敗は黙って覚えておいて、次の起動でもう一度送る
//   - 保存先が設定されていなければ、何もしない

import { loadBests, mergeIntoBests } from './storage.js';
import { sameBests } from '../shared/bests.js';
import { SYNC_URL, SYNC_KEY } from './sync-config.js';

const PENDING_KEY = 'kotobuki.sync.pending.v1';
const TIMEOUT_MS = 8000;

/** 保存先の設定。テストからは差し替えられるように引数で受け取る */
const defaults = () => ({ url: SYNC_URL, key: SYNC_KEY });

export const isConfigured = ({ url } = defaults()) => Boolean(url);

const endpoint = ({ url, key }) => `${url.replace(/\/+$/, '')}/bests/${key}`;

/** 送りそびれているか。起動時に送り直すための目印 */
function setPending(pending) {
  try {
    if (pending) localStorage.setItem(PENDING_KEY, '1');
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* 保存できなくても動く */ }
}

function isPending() {
  try {
    return localStorage.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

async function request(config, method, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(endpoint(config), {
      method,
      signal: controller.signal,
      cache: 'no-store',
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;   // 圏外・保存先が落ちている・設定ミス。どれでも遊べることを優先する
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 保存先から取ってきて端末に取り込む。
 * @returns {Promise<{updated: number, remote: object} | null>} 通信できなければ null
 */
export async function pull(config = defaults()) {
  if (!isConfigured(config)) return null;
  const remote = await request(config, 'GET');
  if (!remote) return null;
  return { ...mergeIntoBests(remote), remote };
}

/**
 * 端末の記録を保存先へ送る。保存先の記録と合わせたものが返るので、それも取り込む。
 * @returns {Promise<{updated: number} | null>}
 */
export async function push(config = defaults()) {
  if (!isConfigured(config)) return null;
  const local = loadBests();
  const merged = await request(config, 'PUT', local);
  if (!merged) {
    setPending(true);
    return null;
  }
  setPending(false);
  // 他の端末で伸びた記録がここで戻ってくる
  return sameBests(local, merged) ? { updated: 0 } : mergeIntoBests(merged);
}

/**
 * 起動時の同期。取り込んで、端末の方が進んでいれば送り返す。
 * @param {() => void} [onUpdated] 記録が変わったときに呼ぶ（画面の描き直し用）
 */
export async function syncOnStart(onUpdated, config = defaults()) {
  if (!isConfigured(config)) return;
  const pulled = await pull(config);
  if (pulled?.updated) onUpdated?.();

  // 保存先が端末より遅れていたら送る。前回送りそびれていたときと、
  // そもそも取りに行けなかったときも送ってみる
  const behind = pulled !== null && !sameBests(pulled.remote, loadBests());
  if (pulled === null || isPending() || behind) {
    const pushed = await push(config);
    if (pushed?.updated) onUpdated?.();
  }
}

/** セッションが終わったので送る。待たない */
export function pushLater(onUpdated, config = defaults()) {
  if (!isConfigured(config)) return;
  push(config).then((result) => {
    if (result?.updated) onUpdated?.();
  });
}
