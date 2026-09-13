// ゲーム全体の定数。spec 3章・6章の数値をここに集約する。
// 未決事項（spec 8章）を実際に遊んでから詰めるとき、触るのはこのファイルだけで済むようにしておく。

/** 盤面の列数 (spec 3.1) */
export const COLS = 5;
/** 盤面の行数 (spec 3.1) */
export const ROWS = 6;

/** セルが取りうる数字の範囲 (spec 3.1) */
export const MIN_VALUE = 1;
export const MAX_VALUE = 9;

/** お題の候補 (spec 3.7) */
export const TARGETS = [10, 15, 20, 25];

/** 制限時間。お題ごとの自己ベストを比較可能にするため固定 (spec 3.6) */
export const DURATION_MS = 120_000;

/** この残り時間を切ったら表示で気づけるようにする (spec 3.6) */
export const WARN_MS = 20_000;

/** チェインは2セル以上必要 (spec 3.3) */
export const MIN_CHAIN_LENGTH = 2;

/** 落下・補充などのアニメーション時間 (spec 3.4 / 6.3) */
export const ANIM_MS = 180;

/** 繋げられないセルの震え (spec 6.5) */
export const SHAKE_MS = 120;
