// 乱数。テストから固定シードで差し込めるように、乱数源は必ず引数で受け取る。

/**
 * mulberry32。seed を与えると再現可能な [0,1) の乱数を返す関数を作る。
 * @param {number} seed
 * @returns {() => number}
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** min 以上 max 以下の整数 */
export function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 配列から1つ選ぶ */
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}
