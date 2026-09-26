// オフラインで起動できるようにアセットをキャッシュする (spec 9章)。
//
// 更新の反映について。
// 以前はキャッシュにあれば必ずそれを返していたため、新しい版を出しても
// 永久に古いままだった（アプリを消して入れ直すしかなかった）。
// いまは返したあとで裏から取り直してキャッシュを差し替える。
// 起動中の画面は古いままだが、次に開いたときには新しくなっている。
//
// アセットを増やしたら ASSETS に足す。CACHE の版は上げなくても更新は届くが、
// 消えたファイルを片付けたいときは上げる。

const CACHE = 'kotobuki-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app/main.js',
  './src/app/board-view.js',
  './src/app/storage.js',
  './src/app/sync.js',
  './src/app/sync-config.js',
  './src/app/play-log.js',
  './src/shared/bests.js',
  './src/shared/log.js',
  './src/game/config.js',
  './src/game/rng.js',
  './src/game/board.js',
  './src/game/solver.js',
  './src/game/generator.js',
  './src/game/game.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);

    // キャッシュの有無にかかわらず裏で取り直して、次回のために置いておく
    const fresh = fetch(request)
      .then(async (response) => {
        if (response.ok && response.type === 'basic') {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => null);

    if (cached) return cached;

    const response = await fresh;
    // オフラインで、キャッシュにも無いページを開こうとしたとき
    return response ?? (await caches.match('./index.html')) ?? Response.error();
  })());
});
