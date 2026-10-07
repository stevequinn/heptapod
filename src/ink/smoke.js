/* ═══════════════════════════════════════════════════════════════════════════
   The ink haze that hangs inside and around a logogram.

   A small tileable alpha mask, generated on demand and cached by seed. Each
   glyph wants its own plume, so these are built per glyph — but a bounded
   cache keeps memory flat across a long session.
   ═══════════════════════════════════════════════════════════════════════════ */

import { fbm2, clamp, smoothstep, mulberry32 } from '../lib/math.js';

const CACHE = new Map();
const MAX = 12;

/**
 * Tile resolution.
 *
 * Low on purpose. This tile is a diffuse wash drawn at roughly three times its
 * own size and linearly filtered the whole way, so there is nothing in it for
 * detail to survive in — and it is evaluated with thirteen octaves of fbm per
 * pixel, so resolution is bought directly in glyph build time. At 224² this
 * was the single most expensive thing about pressing a key.
 */
const SIZE = 96;

function smokeCanvas(seed) {
  const hit = CACHE.get(seed);
  if (hit) {
    // refresh LRU position
    CACHE.delete(seed);
    CACHE.set(seed, hit);
    return hit;
  }
  if (CACHE.size >= MAX) CACHE.delete(CACHE.keys().next().value);

  const rng = mulberry32(0x51ed + seed * 7919);
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const g = cv.getContext('2d');
  const img = g.createImageData(SIZE, SIZE);

  // domain warp, then a hard threshold: the high exponent keeps only the
  // noise ridges, which is what makes filaments rather than a tinted disc.
  const wx = fbm2(rng, 4), wy = fbm2(rng, 4), n2 = fbm2(rng, 5);
  const hot = [
    { x: rng() - 0.5, y: rng() - 0.5, s: 0.22 + rng() * 0.24 },
    { x: rng() - 0.6, y: rng() - 0.6, s: 0.16 + rng() * 0.18 },
  ];

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const nx = (x / SIZE) * 2 - 1, ny = (y / SIZE) * 2 - 1;
      const r = Math.hypot(nx, ny);
      if (r > 1.02) continue;

      let env = smoothstep(0.96, 0.10, r) * 0.30;
      for (const h of hot) {
        const dx = nx - h.x, dy = ny - h.y;
        env = Math.max(env, Math.exp(-(dx * dx + dy * dy) / h.s) * 0.80);
      }

      const a1 = wx(nx * 0.85, ny * 0.85);
      const a2 = wy(nx * 0.85 + 5.1, ny * 0.85 - 2.3);
      const n = Math.pow(clamp(n2(nx * 1.5 + a1 * 1.15, ny * 1.5 + a2 * 1.15) * 1.5 - 0.42, 0, 1), 1.7);

      const i = (y * SIZE + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 6;
      img.data[i + 3] = (clamp(env * n * 1.5, 0, 1) * 214) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  CACHE.set(seed, cv);
  return cv;
}

/**
 * A localised wisp clinging to one side of the ring. The inside of a film
 * logogram is mostly empty — this is one off-centre plume, not a disc.
 */
export function plumeTile(rng) {
  return smokeCanvas(Math.floor(rng() * 64));
}
