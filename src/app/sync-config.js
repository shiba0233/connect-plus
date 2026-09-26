// 記録の保存先。空のままなら端末の中だけで動く（保存先が無くても遊べる）。
//
// Cloudflare Worker をデプロイしたら、その URL をここに貼る。
// 手順は README の「記録の保存先」を見る。

/** Cloudflare Workers + KV（worker/index.js）。空にすると端末の中だけで動く */
export const SYNC_URL = 'https://connect-plus-bests.ibs22510.workers.dev';

/**
 * 保存先の中での置き場所の名前。
 * リポジトリが public なので秘密にはならないが、推測されにくい文字列にしておく。
 * 変えると別の置き場所になる（それまでの記録は読めなくなる）。
 */
export const SYNC_KEY = 'k7m2rq9xv4';
