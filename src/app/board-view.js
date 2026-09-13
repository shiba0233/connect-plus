// 盤面の描画となぞり操作。ゲームのルールは持たず、指の動きを index に変えて渡すだけ。

import { ANIM_MS } from '../game/config.js';

/** なぞりの間を補間するときの刻み（セルの何分の1か）。速く動かしても途中のセルを拾えるように */
const SAMPLE_DIVISOR = 3;

/*
 * なぞっている最中に反応する範囲は、セルに内接する円（セル幅の何倍か）。四隅は反応しない。
 * 斜め2マスへ繋ぐには間のセルを避けて回り込む必要があり、その通り道として四隅の余白が要る
 * （真っ直ぐなぞると間のセルの中心を必ず踏むため）。
 * なぞり始めだけはセル全体で受ける。押さえた場所が反応しないのは分かりにくいので。
 */
const HIT_RADIUS_RATIO = 0.42;

export class BoardView {
  /**
   * @param {object} elements
   * @param {HTMLElement} elements.board   なぞり操作を受ける枠
   * @param {HTMLElement} elements.tiles   セルの下地を置く層
   * @param {HTMLElement} elements.labels  数字を置く層（線より上）
   * @param {SVGSVGElement} elements.svg
   * @param {SVGPolylineElement} elements.polyline
   * @param {{onBegin: (index: number) => void, onExtend: (index: number) => void, onEnd: () => void}} handlers
   */
  constructor({ board, tiles, labels, svg, polyline }, handlers) {
    this.el = board;
    this.tiles = tiles;
    this.labels = labels;
    this.svg = svg;
    this.polyline = polyline;
    this.handlers = handlers;
    /** @type {Map<number, {tile: HTMLElement, label: HTMLElement}>} セルの id -> 要素 */
    this.nodes = new Map();
    this.cols = 0;
    this.rows = 0;
    this.rect = null;
    this.pointerId = null;
    this.started = false;
    this.hovered = -1;
    this.lastPoint = null;

    this.el.addEventListener('pointerdown', this.onPointerDown);
    this.el.addEventListener('pointermove', this.onPointerMove);
    this.el.addEventListener('pointerup', this.onPointerUp);
    this.el.addEventListener('pointercancel', this.onPointerUp);
    // なぞり中に画面が動かないように、念のため既定動作も止める (spec 6.4)
    this.el.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // ------------------------------------------------------------ 描画

  /** 盤面の大きさを画面に伝える。列数・行数はここだけで決まる */
  setSize(cols, rows) {
    if (this.cols === cols && this.rows === rows) return;
    this.cols = cols;
    this.rows = rows;
    this.el.style.setProperty('--cols', String(cols));
    this.el.style.setProperty('--rows', String(rows));
    this.svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  }

  /** 盤面の状態を画面に反映する。落下は transform の変化に任せる */
  sync(board, { spawned = [], reshuffled = false } = {}) {
    this.setSize(board.cols, board.rows);
    const spawnedIds = new Set(spawned);

    board.cells.forEach((cell, index) => {
      let node = this.nodes.get(cell.id);
      if (!node) {
        node = this.createNode(cell, index);
        if (spawnedIds.has(cell.id)) this.animate(node, 'is-spawning');
        this.tiles.appendChild(node.tile);
        this.labels.appendChild(node.label);
        this.nodes.set(cell.id, node);
      }
      const text = String(cell.value);
      if (node.num.textContent !== text) node.num.textContent = text;
      node.tile.dataset.index = String(index);
      node.label.dataset.index = String(index);
      this.place(node, index);
      if (reshuffled && !spawnedIds.has(cell.id)) this.animate(node, 'is-reshuffled');
    });
  }

  createNode(cell, index) {
    const tile = document.createElement('div');
    tile.className = 'cell cell--tile';
    tile.appendChild(document.createElement('div')).className = 'cell__face';

    const label = document.createElement('div');
    label.className = 'cell cell--label';
    const num = document.createElement('span');
    num.className = 'cell__num';
    num.textContent = String(cell.value);
    label.appendChild(num);

    const node = { tile, label, num };
    this.place(node, index);
    return node;
  }

  place(node, index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    const transform = `translate(${col * 100}%, ${row * 100}%)`;
    node.tile.style.transform = transform;
    node.label.style.transform = transform;
  }

  /** 消えるセル。アニメーションが終わってから要素を外す */
  clearCells(ids) {
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node) continue;
      this.nodes.delete(id);
      node.tile.classList.add('is-clearing');
      node.label.classList.add('is-clearing');
      setTimeout(() => {
        node.tile.remove();
        node.label.remove();
      }, ANIM_MS + 40);
    }
  }

  /**
   * チェインの見た目。線はセル中心を結ぶ (spec 6.5)。
   * 線はタイルの上・数字の下に描く。斜め2マスで間のセルを飛び越えたことが線で分かり、
   * それでいて数字は線に隠れない。
   * @param {import('../game/board.js').Board} board
   * @param {number[]} chain
   * @param {boolean} complete 合計がお題ちょうどか
   */
  showChain(board, chain, complete = false) {
    const chained = new Set(chain.map((index) => board.cells[index].id));
    for (const [id, node] of this.nodes) {
      node.tile.classList.toggle('is-chained', chained.has(id));
    }
    this.polyline.setAttribute('points', chain.map((index) => {
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      return `${col + 0.5},${row + 0.5}`;
    }).join(' '));
    this.svg.classList.toggle('is-complete', complete);
  }

  /** 繋げられないセルを短く震わせる (spec 6.5) */
  shake(index) {
    for (const node of this.nodes.values()) {
      if (node.tile.dataset.index === String(index)) {
        this.animate(node, 'is-shaking');
        return;
      }
    }
  }

  animate(node, className) {
    for (const element of [node.tile, node.label]) {
      element.classList.remove(className);
      void element.offsetWidth;          // アニメーションをやり直させる
      element.classList.add(className);
      setTimeout(() => element.classList.remove(className), ANIM_MS + 60);
    }
  }

  reset() {
    this.tiles.replaceChildren();
    this.labels.replaceChildren();
    this.nodes.clear();
    this.polyline.setAttribute('points', '');
    this.svg.classList.remove('is-complete');
    this.pointerId = null;
    this.started = false;
    this.hovered = -1;
    this.lastPoint = null;
  }

  // ------------------------------------------------------------ 操作

  /**
   * 画面の座標をセルの index に変える。
   * @param {number} x
   * @param {number} y
   * @param {boolean} strict 中心付近だけを拾う（なぞっている最中）
   */
  indexAt(x, y, strict) {
    const rect = this.rect;
    if (!rect) return -1;
    const localX = x - rect.left;
    const localY = y - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return -1;

    const cellWidth = rect.width / this.cols;
    const cellHeight = rect.height / this.rows;
    const col = Math.floor(localX / cellWidth);
    const row = Math.floor(localY / cellHeight);

    if (strict) {
      // セルの中心から離れすぎている（＝四隅の余白にいる）ときはどのセルでもない
      const dx = localX - (col + 0.5) * cellWidth;
      const dy = localY - (row + 0.5) * cellHeight;
      const radius = Math.min(cellWidth, cellHeight) * HIT_RADIUS_RATIO;
      if (dx * dx + dy * dy > radius * radius) return -1;
    }

    return row * this.cols + col;
  }

  onPointerDown = (event) => {
    if (this.pointerId !== null) return;
    this.rect = this.el.getBoundingClientRect();
    event.preventDefault();
    this.pointerId = event.pointerId;
    this.el.setPointerCapture(event.pointerId);
    this.started = false;
    this.hovered = -1;
    this.lastPoint = { x: event.clientX, y: event.clientY };
    // 押さえ始めはセル全体で受ける
    this.enter(this.indexAt(event.clientX, event.clientY, false));
  };

  onPointerMove = (event) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    const from = this.lastPoint;
    const to = { x: event.clientX, y: event.clientY };
    this.lastPoint = to;

    // 指を速く動かしても間のセルを飛ばさないよう、前回位置からの線分を刻んで拾う
    const step = Math.max(8, this.rect.width / this.cols / SAMPLE_DIVISOR);
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const samples = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= samples; i += 1) {
      this.enter(this.indexAt(
        from.x + ((to.x - from.x) * i) / samples,
        from.y + ((to.y - from.y) * i) / samples,
        true,
      ));
    }
  };

  /** セルに乗った。同じセルに乗り続けている間は何もしない (spec 6.5) */
  enter(index) {
    if (index < 0 || index === this.hovered) return;
    this.hovered = index;
    if (this.started) {
      this.handlers.onExtend(index);
    } else {
      this.started = true;
      this.handlers.onBegin(index);
    }
  }

  onPointerUp = (event) => {
    if (event.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.started = false;
    this.hovered = -1;
    this.lastPoint = null;
    this.handlers.onEnd();
  };
}
