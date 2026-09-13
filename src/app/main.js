// 画面の組み立て。ホーム → プレイ → 結果。

import { TARGETS, WARN_MS } from '../game/config.js';
import { Game } from '../game/game.js';
import { BoardView } from './board-view.js';
import { getBest, loadBests, saveBest, loadSettings, saveSettings, THEMES } from './storage.js';

const THEME_LABELS = { dark: 'ダーク', light: 'ライト', system: '端末に合わせる' };

const el = (id) => document.getElementById(id);

const screens = {
  home: el('screen-home'),
  play: el('screen-play'),
  result: el('screen-result'),
};

const ui = {
  targetList: el('target-list'),
  themeButton: el('theme-button'),
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

const boardView = new BoardView(el('board'), el('chain-polyline'), {
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
    best.append('ベスト', Object.assign(document.createElement('b'), {
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
  ui.chainSum.textContent = '0';
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
    case 'cleared':
      commitCleared(result);
      break;
    default:
      break;
  }
}

function handleEnd() {
  if (!game) return;
  game.endChain();
  updateChain();
}

function updateChain() {
  boardView.showChain(game.board, game.chain);
  ui.chainSum.textContent = String(game.chainSum);
}

function commitCleared(result) {
  boardView.clearCells(result.removed);
  boardView.sync(game.board, { spawned: result.spawned, reshuffled: result.reshuffled });
  boardView.showChain(game.board, []);
  ui.chainSum.textContent = '0';
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
  const previousBest = getBest(target);
  const updated = saveBest(target, score);
  // 初回プレイで0点のときまで「更新」とは言わない
  const celebrate = updated && (Number.isInteger(previousBest) || score > 0);

  ui.resultTarget.textContent = String(target);
  ui.resultScore.textContent = String(score);
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

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* オフライン対応が無くても遊べる */ });
  });
}
