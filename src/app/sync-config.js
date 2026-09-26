// 記録の保存先。空のままなら端末の中だけで動く（保存先が無くても遊べる）。
//
// Cloudflare Worker をデプロイしたら、その URL をここに貼る。
// 手順は README の「記録の保存先」を見る。

/** 例: "https://connect-plus-bests.<サブドメイン>.workers.dev" */
export const SYNC_URL = '';

/**
 * 保存先の中での置き場所の名前。
 * リポジトリが public なので秘密にはならないが、推測されにくい文字列にしておく。
 * 変えると別の置き場所になる（それまでの記録は読めなくなる）。
 */
export const SYNC_KEY = 'k7m2rq9xv4';
