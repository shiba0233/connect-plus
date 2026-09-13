// 盤面の描画となぞり操作。ゲームのルールは持たず、指の動きを index に変えて渡すだけ。

import { ANIM_MS } from '../game/config.js';

/** なぞりの間を補間するときの刻み（セルの何分の1か）。速く動かしても途中のセルを拾えるように */
const SAMPLE_DIVISOR = 3;

/*
 * 反応する範囲はセルに内接する円（セル幅の何倍か）。四隅は反応しない。
 * - 斜め2マスへ繋ぐには、間のセルを避けて回り込む必要がある。その通り道として四隅の
 *   余白が要る（真っ直ぐなぞると間のセルの中心をどうしても踏むため）
 * - 0.4 でも 5列の盤面なら直径はセル幅の8割あり、44pt は確保できる (spec 6.4)
 */
const HIT_RADIUS_RATIO = 0.4;

export class BoardView {
  /**
   * @param {HTMLElement} element
   * @param {SVGPolylineElement} polyline
   * @param {{onBegin: (index: number) => void, onExtend: (index: number) => void, onEnd: () => void}} handlers
   */
  constructor(element, polyline, handlers) {
    this.el = element;
    this.polyline = polyline;
    this.handlers = handlers;
    /** @type {Map<number, HTMLElement>} セルの id -> 要素 */
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

  /** 盤面の状態を画面に反映する。落下は transform の変化に任せる */
  sync(board, { spawned = [], reshuffled = false } = {}) {
    this.cols = board.cols;
    this.rows = board.rows;
    const spawnedIds = new Set(spawned);

    board.cells.forEach((cell, index) => {
      let node = this.nodes.get(cell.id);
      if (!node) {
        node = this.createNode(cell, index);
        if (spawnedIds.has(cell.id)) this.animate(node, 'is-spawning');
        this.el.appendChild(node);
        this.nodes.set(cell.id, node);
      }
      const face = node.firstElementChild;
      if (face.textContent !== String(cell.value)) face.textContent = String(cell.value);
      node.dataset.index = String(index);
      this.place(node, index);
      if (reshuffled && !spawnedIds.has(cell.id)) this.animate(node, 'is-reshuffled');
    });
  }

  createNode(cell, index) {
    const node = document.createElement('div');
    node.className = 'cell';
    node.dataset.index = String(index);
    const face = document.createElement('div');
    face.className = 'cell__face';
    face.textContent = String(cell.value);
    node.appendChild(face);
    this.place(node, index);
    return node;
  }

  place(node, index) {
    const col = index % this.cols;
    const row = Math.floor(index / this.cols);
    node.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  /** 消えるセル。アニメーションが終わってから要素を外す */
  clearCells(ids) {
    for (const id of ids) {
      const node = this.nodes.get(id);
      if (!node) continue;
      this.nodes.delete(id);
      node.classList.add('is-clearing');
      setTimeout(() => node.remove(), ANIM_MS + 40);
    }
  }

  /** チェインの見た目。線はセル中心を結ぶ (spec 6.5) */
  showChain(board, chain) {
    const chained = new Set(chain.map((index) => board.cells[index].id));
    for (const [id, node] of this.nodes) {
      node.classList.toggle('is-chained', chained.has(id));
    }
    this.polyline.setAttribute('points', chain.map((index) => {
      const col = index % this.cols;
      const row = Math.floor(index / this.cols);
      return `${col + 0.5},${row + 0.5}`;
    }).join(' '));
  }

  /** 繋げられないセルを短く震わせる (spec 6.5) */
  shake(index) {
    const node = this.el.querySelector(`.cell[data-index="${index}"]:not(.is-clearing)`);
    if (node) this.animate(node, 'is-shaking');
  }

  animate(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;          // アニメーションをやり直させる
    node.classList.add(className);
    setTimeout(() => node.classList.remove(className), ANIM_MS + 60);
  }

  reset() {
    for (const node of this.nodes.values()) node.remove();
    this.nodes.clear();
    this.polyline.setAttribute('points', '');
    this.pointerId = null;
    this.started = false;
    this.hovered = -1;
    this.lastPoint = null;
  }

  // ------------------------------------------------------------ 操作

  indexAt(x, y) {
    const rect = this.rect;
    if (!rect) return -1;
    const localX = x - rect.left;
    const localY = y - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return -1;

    const cellWidth = rect.width / this.cols;
    const cellHeight = rect.height / this.rows;
    const col = Math.floor(localX / cellWidth);
    const row = Math.floor(localY / cellHeight);

    // セルの中心から離れすぎている（＝四隅の余白にいる）ときはどのセルでもない
    const dx = localX - (col + 0.5) * cellWidth;
    const dy = localY - (row + 0.5) * cellHeight;
    const radius = Math.min(cellWidth, cellHeight) * HIT_RADIUS_RATIO;
    if (dx * dx + dy * dy > radius * radius) return -1;

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
    // 余白から押さえ始めたときは、最初にセルへ乗ったところからチェインが始まる
    this.enter(this.indexAt(event.clientX, event.clientY));
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
      const index = this.indexAt(
        from.x + ((to.x - from.x) * i) / samples,
        from.y + ((to.y - from.y) * i) / samples,
      );
      this.enter(index);
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
