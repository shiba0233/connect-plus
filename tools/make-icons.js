// アイコンを作る。`npm run icons` で icons/*.png を書き出す。
// 外部依存を入れたくないので、PNG は自前で組み立てている。

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = [0x12, 0x12, 0x12];
const PLATE = [0x1e, 0x1e, 0x1e];
const ACCENT = [0x7f, 0xa6, 0xb5];

/** 角丸四角形の内側か（1px ぶんのぼかし付き） */
function roundedRectCoverage(x, y, left, top, right, bottom, radius) {
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const distance = Math.hypot(x - cx, y - cy);
  if (x < left || x > right || y < top || y > bottom) return 0;
  return distance <= radius ? 1 : 0;
}

function blend(base, color, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + color[0] * alpha),
    Math.round(base[1] * (1 - alpha) + color[1] * alpha),
    Math.round(base[2] * (1 - alpha) + color[2] * alpha),
  ];
}

/**
 * 盤面のセルを1枚置いて、その上に「+」を描く。
 * @param {number} size
 * @param {{maskable?: boolean}} [options]
 */
function drawIcon(size, { maskable = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  // maskable は端が削られるので、中身を内側に寄せる
  const inset = maskable ? size * 0.22 : size * 0.12;
  const plate = { left: inset, top: inset, right: size - inset, bottom: size - inset, radius: size * 0.14 };
  const barLength = (plate.right - plate.left) * 0.52;
  const barWidth = (plate.right - plate.left) * 0.145;
  const center = size / 2;
  const samples = 3;   // スーパーサンプリングで縁をなめらかに

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let plateHits = 0;
      let barHits = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;
          plateHits += roundedRectCoverage(px, py, plate.left, plate.top, plate.right, plate.bottom, plate.radius);
          const horizontal = roundedRectCoverage(
            px, py,
            center - barLength / 2, center - barWidth / 2,
            center + barLength / 2, center + barWidth / 2,
            barWidth / 2,
          );
          const vertical = roundedRectCoverage(
            px, py,
            center - barWidth / 2, center - barLength / 2,
            center + barWidth / 2, center + barLength / 2,
            barWidth / 2,
          );
          barHits += Math.max(horizontal, vertical);
        }
      }
      const total = samples * samples;
      let color = BG;
      color = blend(color, PLATE, plateHits / total);
      color = blend(color, ACCENT, barHits / total);

      const offset = (y * size + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 6;      // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;   // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, options] of targets) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, drawIcon(size, options)));
  console.log(`${name} (${size}x${size})`);
}
