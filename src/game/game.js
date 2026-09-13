// 1セッションぶんのゲーム。盤面・チェイン・スコア・時間を持つ。
// DOM も localStorage も触らない。画面側はここが返す結果を見て描くだけにする。

import { COLS, ROWS, DURATION_MS, MIN_CHAIN_LENGTH } from './config.js';
import { createSolvableBoard, ensureSolvable } from './generator.js';

/** @typedef {'ready' | 'playing' | 'over'} GameState */

export class Game {
  /**
   * @param {object} options
   * @param {number} options.target お題（セッション中は変わらない / spec 2章）
   * @param {() => number} [options.rng]
   * @param {number} [options.durationMs]
   * @param {number} [options.cols]
   * @param {number} [options.rows]
   */
  constructor({ target, rng = Math.random, durationMs = DURATION_MS, cols = COLS, rows = ROWS }) {
    this.target = target;
    this.rng = rng;
    this.durationMs = durationMs;
    this.board = createSolvableBoard(target, { cols, rows, rng });
    /** @type {GameState} */
    this.state = 'ready';
    this.score = 0;
    /** @type {number[]} なぞっているセルの index */
    this.chain = [];
    this.chainSum = 0;
    this.startedAt = 0;
    this.endsAt = 0;
  }

  start(now = Date.now()) {
    this.state = 'playing';
    this.startedAt = now;
    this.endsAt = now + this.durationMs;
    return this;
  }

  remainingMs(now = Date.now()) {
    if (this.state === 'ready') return this.durationMs;
    return Math.max(0, this.endsAt - now);
  }

  /** 時間を進める。タイムアップしたらその場でセッションを終える */
  update(now = Date.now()) {
    if (this.state === 'playing' && now >= this.endsAt) {
      this.state = 'over';
      // 時間切れの瞬間になぞっていたチェインは、成立していても消えない
      this.resetChain();
    }
    return this.state;
  }

  /** 時間切れを待たずに中断する。中断したセッションのスコアは記録しない (spec 4.2) */
  abort() {
    this.state = 'over';
    this.resetChain();
  }

  get isPlaying() {
    return this.state === 'playing';
  }

  /** 合計がお題ちょうどで、2セル以上ある。指を離せば消える状態 */
  get isComplete() {
    return this.chainSum === this.target && this.chain.length >= MIN_CHAIN_LENGTH;
  }

  /**
   * なぞり始め。
   * @param {number} index
   * @returns {{type: 'started' | 'rejected' | 'ignored', index?: number}}
   */
  beginChain(index) {
    if (!this.isPlaying) return { type: 'ignored' };
    if (this.board.valueAt(index) > this.target) return { type: 'rejected', index };
    this.chain = [index];
    this.chainSum = this.board.valueAt(index);
    return { type: 'started', index };
  }

  /**
   * なぞり先を伸ばす。戻れば外れる。
   * 合計がちょうど一致してもここでは消さない。消えるのは指を離したとき (endChain)。
   * 繋げられない理由（超過・位置・重複）による出し分けはしない (spec 6.5)。
   * @param {number} index
   * @returns {{type: 'added' | 'removed' | 'rejected' | 'ignored', index?: number}}
   */
  extendChain(index) {
    if (!this.isPlaying || this.chain.length === 0) return { type: 'ignored' };

    const last = this.chain[this.chain.length - 1];
    if (index === last) return { type: 'ignored' };

    // 直前のセルへ戻ると、そのセルがチェインから外れる (spec 3.2)
    if (this.chain.length >= 2 && index === this.chain[this.chain.length - 2]) {
      const dropped = this.chain.pop();
      this.chainSum -= this.board.valueAt(dropped);
      return { type: 'removed', index: dropped };
    }

    if (this.chain.includes(index)) return { type: 'rejected', index };
    if (!this.board.isConnectable(last, index)) return { type: 'rejected', index };

    const sum = this.chainSum + this.board.valueAt(index);
    if (sum > this.target) return { type: 'rejected', index };  // 超過はNG (spec 3.3)

    this.chain.push(index);
    this.chainSum = sum;
    return { type: 'added', index };
  }

  /**
   * 指を離した。合計がお題ちょうどなら成立して消える。
   * 足りないまま離した場合は不成立で、解除されるだけ。ペナルティは無い (spec 3.3)。
   *
   * 一致した瞬間ではなく指を離したときに消すのは、プレイヤーに取り消す余地を残すため。
   * なぞっている途中でたまたま一致しても、戻って別の繋ぎ方に変えられる。
   *
   * @returns {{type: 'cleared', cells: number[], removed: number[], spawned: number[], gained: number, score: number, reshuffled: boolean} | {type: 'released'}}
   */
  endChain() {
    if (!this.isPlaying || !this.isComplete) {
      this.resetChain();
      return { type: 'released' };
    }
    return this.commitChain();
  }

  /**
   * 成立。消して、落として、補充して、詰みを確認する。
   * @returns {{type: 'cleared', cells: number[], removed: number[], spawned: number[], gained: number, score: number, reshuffled: boolean}}
   */
  commitChain() {
    const cells = this.chain.slice();
    const { removed, spawned } = this.board.clear(cells);
    this.score += cells.length;   // スコアは消したセルの総数 (spec 3.6)
    this.resetChain();
    const reshuffled = ensureSolvable(this.board, this.target, this.rng);
    return { type: 'cleared', cells, removed, spawned, gained: cells.length, score: this.score, reshuffled };
  }

  resetChain() {
    this.chain = [];
    this.chainSum = 0;
  }
}
