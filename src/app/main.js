// 画面の組み立て。ホーム → プレイ → 結果。

import { TARGETS, WARN_MS } from '../game/config.js';
import { Game } from '../game/game.js';
import { BoardView } from './board-view.js';
import { syncOnStart, pushLater } from './sync.js';
import { record as recordPlay, loadAll as loadPlayLog, flush as flushPlayLog } from './play-log.js';
import { summarizeByHour, MIN_SAMPLES } from '../shared/log.js';
import { getBest, loadBests, saveBest, loadSettings, saveSettings, THEMES, requestPersistence } from './storage.js';

const THEME_LABELS = { dark: 'ダーク', light: 'ライト', system: '端末に合わせる' };

const el = (id) => document.getElementById(id);

const screens = {
  home: el('screen-home'),
  play: el('screen-play'),
  stats: el('screen-stats'),
  result: el('screen-result'),
};

const ui = {
  targetList: el('target-list'),
  themeButton: el('theme-button'),
  statsButton: el('stats-button'),
  statsBack: el('stats-back'),
  statsLead: el('stats-lead'),
  statsChart: el('stats-chart'),
  statsNote: el('stats-note'),
  targetValue: el('target-value'),
  timeValue: el('time-value'),
  scoreValue: el('score-value'),
  bestItem: el('best-item'),
  bestLabel: el('best-label'),
  bestValue: el('best-value'),
  quitButton: el('quit-button'),
  chainSum: el('chain-sum-value'),
  resultTarget: el('result-target'),
  resultScore: el('result-score'),
  resultBest: el('result-best'),
  retryButton: el('retry-button'),
  homeButton: el('home-button'),
};

const boardView = new BoardView({
  board: el('board'),
  tiles: el('board-tiles'),
  labels: el('board-labels'),
  svg: el('chain-line'),
  polyline: el('chain-polyline'),
}, {
  onBegin: handleBegin,
  onExtend: handleExtend,
  onEnd: handleEnd,
});

/** @type {Game | null} */
let game = null;
let settings = loadSettings();
let frame = 0;
let shownSeconds = -1;
let beatingBest = false;

// ---------------------------------------------------------------- 画面遷移

function show(name) {
  for (const [key, section] of Object.entries(screens)) section.hidden = key !== name;
}

// ---------------------------------------------------------------- ホーム

function renderHome() {
  const bests = loadBests();
  ui.targetList.replaceChildren(...TARGETS.map((target) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'target-button';
    button.dataset.target = String(target);

    const value = document.createElement('span');
    value.className = 'target-button__value';
    value.textContent = String(target);

    const best = document.createElement('span');
    best.className = 'target-button__best';
    const score = bests[target];
    // 未プレイなら「—」 (spec 4.1)
    best.append('best', Object.assign(document.createElement('b'), {
      textContent: Number.isInteger(score) ? String(score) : '—',
    }));

    button.append(value, best);
    // お題をタップするとそのままセッション開始（確認を挟まない） (spec 4.1)
    button.addEventListener('click', () => startGame(target));
    item.appendChild(button);
    return item;
  }));
}

function renderTheme() {
  document.documentElement.dataset.theme = settings.theme;
  ui.themeButton.textContent = `テーマ: ${THEME_LABELS[settings.theme]}`;
}

// ---------------------------------------------------------------- 時間帯 (spec 4.4)

const hourLabel = (hour) => `${hour}時`;

/** 平均からの離れ具合を、一番離れている時間帯を基準にした長さに直す */
function barLength(deviation, scale) {
  if (scale <= 0) return '0%';
  return `${Math.min(50, (Math.abs(deviation) / scale) * 50)}%`;
}

function renderStats(entries) {
  const { hours, total, best } = summarizeByHour(entries);

  if (total === 0) {
    ui.statsLead.innerHTML = '';
    ui.statsChart.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'stats__empty',
      textContent: 'まだ記録がありません。何回か遊ぶとここに出ます。',
    }));
    ui.statsNote.textContent = '';
    return;
  }

  ui.statsLead.innerHTML = best === null
    ? 'まだ傾向は出ていません。'
    : `いまのところ <b>${hourLabel(best)}台</b> が一番いいです。`;

  const scale = Math.max(...hours.map((hour) => Math.abs(hour.index - 100)), 1);
  const rows = hours.map((hour) => {
    const deviation = hour.index - 100;
    const row = document.createElement('div');
    row.className = `chart__row${hour.hour === best ? ' is-best' : ''}`;

    const label = document.createElement('span');
    label.className = 'chart__hour';
    label.textContent = hourLabel(hour.hour);

    const track = document.createElement('div');
    track.className = 'chart__track';
    if (deviation !== 0) {
      const bar = document.createElement('div');
      bar.className = `chart__bar chart__bar--${deviation > 0 ? 'up' : 'down'}`;
      bar.style.setProperty('--len', barLength(deviation, scale));
      track.appendChild(bar);
    }

    const value = document.createElement('span');
    value.className = 'chart__value';
    value.textContent = `${deviation > 0 ? '+' : ''}${deviation}`;

    // 回数が少ない時間帯は、たまたまの可能性が高い。数字を見せて薄くする
    const count = document.createElement('span');
    count.className = 'chart__count';
    count.textContent = `${hour.n}回`;
    if (hour.n < MIN_SAMPLES) row.classList.add('is-thin');

    // 画面を見なくても中身が分かるようにしておく
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label',
      `${hourLabel(hour.hour)}台 ${hour.n}回 平均${hour.mean}点 自分の平均比${hour.index}`);

    row.append(label, track, value, count);
    return row;
  });

  const axis = document.createElement('div');
  axis.className = 'chart__axis';
  axis.append(
    Object.assign(document.createElement('span'), { textContent: '' }),
    Object.assign(document.createElement('span'), { textContent: '← 平均より下　|　平均より上 →' }),
    Object.assign(document.createElement('span'), { textContent: '' }),
  );

  ui.statsChart.setAttribute('role', 'list');
  ui.statsChart.replaceChildren(...rows, axis);

  ui.statsNote.textContent = [
    `全${total}プレイ。`,
    'お題によってスコアの桁が違うので、同じお題での自分の平均を100として、その差を出しています。',
    `${MIN_SAMPLES}回以上遊んだ時間帯どうしでしか「一番」は選びません。薄い行は回数が足りていない時間帯です。`,
  ].join('\n');
}

ui.statsButton.addEventListener('click', () => {
  renderStats(loadPlayLog(renderStats));   // 保存先のぶんが届いたら描き直す
  show('stats');
});

ui.statsBack.addEventListener('click', () => {
  show('home');
});

// ---------------------------------------------------------------- テーマ

ui.themeButton.addEventListener('click', () => {
  settings = { ...settings, theme: THEMES[(THEMES.indexOf(settings.theme) + 1) % THEMES.length] };
  saveSettings(settings);
  renderTheme();
});

// ---------------------------------------------------------------- プレイ

function startGame(target) {
  stopLoop();
  boardView.reset();
  game = new Game({ target });
  game.start(performance.now());

  shownSeconds = -1;
  beatingBest = false;

  ui.targetValue.textContent = String(target);
  ui.scoreValue.textContent = '0';
  showChainSum();
  ui.timeValue.classList.remove('is-warn');
  ui.bestItem.classList.remove('is-best');
  ui.bestLabel.textContent = 'ベスト';
  const best = getBest(target);
  ui.bestValue.textContent = Number.isInteger(best) ? String(best) : '—';

  boardView.sync(game.board);
  boardView.showChain(game.board, []);
  show('play');
  frame = requestAnimationFrame(tick);
}

function tick(now) {
  frame = requestAnimationFrame(tick);
  if (!game) return;

  if (game.update(now) === 'over') {
    finishGame();
    return;
  }

  const remaining = game.remainingMs(now);
  const seconds = Math.ceil(remaining / 1000);
  if (seconds !== shownSeconds) {
    shownSeconds = seconds;
    ui.timeValue.textContent = String(seconds);
    // 残り20秒を切ったら色で気づけるようにする。点滅はしない (spec 3.6 / 6.3)
    ui.timeValue.classList.toggle('is-warn', remaining <= WARN_MS);
  }
}

function stopLoop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function handleBegin(index) {
  if (!game) return;
  const result = game.beginChain(index);
  if (result.type === 'rejected') boardView.shake(index);
  if (result.type === 'started') updateChain();
}

function handleExtend(index) {
  if (!game) return;
  const result = game.extendChain(index);
  switch (result.type) {
    case 'added':
    case 'removed':
      updateChain();
      break;
    case 'rejected':
      // 理由による出し分けはしない (spec 6.5)
      boardView.shake(index);
      break;
    default:
      break;
  }
}

/** 指を離した。合計がお題ちょうどならここで消える */
function handleEnd() {
  if (!game) return;
  const result = game.endChain();
  if (result.type === 'cleared') {
    commitCleared(result);
  } else {
    updateChain();
  }
}

function updateChain() {
  boardView.showChain(game.board, game.chain, game.isComplete);
  showChainSum(game.chain.length ? game.chainSum : null, game.isComplete);
}

/** なぞっていないときは数字を出さない */
function showChainSum(sum = null, complete = false) {
  ui.chainSum.textContent = sum === null ? '—' : String(sum);
  ui.chainSum.classList.toggle('is-complete', complete);
}

function commitCleared(result) {
  boardView.clearCells(result.removed);
  boardView.sync(game.board, { spawned: result.spawned, reshuffled: result.reshuffled });
  boardView.showChain(game.board, []);
  showChainSum();
  ui.scoreValue.textContent = String(game.score);

  // ベストを超えた瞬間に、その場で分かるようにする (spec 3.7)
  const best = getBest(game.target);
  if (!beatingBest && Number.isInteger(best) && game.score > best) {
    beatingBest = true;
    ui.bestItem.classList.add('is-best');
    ui.bestLabel.textContent = 'ベスト更新';
  }
  if (beatingBest) ui.bestValue.textContent = String(game.score);
}

// 中断はいつでも可能。中断したセッションのスコアは記録しない (spec 4.2)
ui.quitButton.addEventListener('click', () => {
  if (!game) return;
  game.abort();
  stopLoop();
  boardView.reset();
  game = null;
  renderHome();
  show('home');
});

// ---------------------------------------------------------------- 結果

function finishGame() {
  stopLoop();
  const { target, score } = game;
  // 時間帯の傾向を見るために、成立したセッションは毎回残す (spec 4.4)
  recordPlay({ target, score });

  const previousBest = getBest(target);
  const updated = saveBest(target, score);
  // 初回プレイで0点のときまで「更新」とは言わない
  const celebrate = updated && (Number.isInteger(previousBest) || score > 0);

  ui.resultTarget.textContent = String(target);
  ui.resultScore.textContent = String(score);
  // 記録は保存先にも預ける。プレイヤーは何もしなくてよい
  if (updated) pushLater(renderHome);

  ui.resultBest.classList.toggle('is-updated', celebrate);
  ui.resultBest.textContent = celebrate
    ? `自己ベスト更新！ ${Number.isInteger(previousBest) ? `${previousBest} → ` : ''}${score}`
    : `自己ベスト ${Number.isInteger(previousBest) ? Math.max(previousBest, score) : score}`;

  boardView.reset();
  show('result');
}

ui.retryButton.addEventListener('click', () => {
  const target = game ? game.target : TARGETS[0];
  startGame(target);
});

ui.homeButton.addEventListener('click', () => {
  game = null;
  renderHome();
  show('home');
});

// ---------------------------------------------------------------- 起動

// バックグラウンドに回っている間もタイマーは進む。戻ってきたら一度整える
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && game && game.isPlaying) {
    shownSeconds = -1;
    if (!frame) frame = requestAnimationFrame(tick);
  }
});

renderTheme();
renderHome();
show('home');

// しばらく遊ばなかったときに記録を消されないよう頼んでおく（断られても遊べる）
requestPersistence();

// 送りそびれたプレイの記録を送り直す
flushPlayLog();

// 保存先から記録を取り込む。通信できなくても遊べる
syncOnStart(() => {
  if (screens.home.hidden) return;   // 遊んでいる最中に画面を描き直さない
  renderHome();
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン対応が無くても遊べる */ });
  });
}
