// ローカル保存だけ (spec 5章)。サーバーもアカウントも持たない。
// データが消えても致命的ではない前提。読めなければ既定値で動かす。

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

export function loadSettings() {
  const stored = read(SETTINGS_KEY);
  const theme = stored && THEMES.includes(stored.theme) ? stored.theme : DEFAULT_SETTINGS.theme;
  return { theme };
}

export function saveSettings(settings) {
  write(SETTINGS_KEY, { theme: THEMES.includes(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme });
}

export { THEMES };
