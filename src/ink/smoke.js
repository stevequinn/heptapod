/* ═══════════════════════════════════════════════════════════════════════════
   Smoke: the ink haze inside a logogram, and the ink-in-water cloud a glyph
   materialises out of.

   Two different sheets live here:

     plumeTile      the faint wash that clings inside a finished glyph
     cloudTile      one shared, tileable sheet of turbulent ink, layered by
                    the writer while a glyph condenses out of the water

   Both are alpha masks. The cloud is generated once per session — it is the
   same water for every glyph — while the plumes are per glyph and bounded by
   an LRU cache.
   ═══════════════════════════════════════════════════════════════════════════ */

import { fbm2, clamp, clamp01, smoothstep, mulberry32 } from '../lib/math.js';

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

/* ═══ the ink-in-water sheet ════════════════════════════════════════════ */

/**
 * Tile resolution. Larger than the plume because this is drawn at close to
 * its own scale and the filaments have to survive; it is generated once per
 * session, so the cost is a one-off.
 */
const CLOUD_SIZE = 256;
let CLOUD = null;

/**
 * One tileable sheet of ink dropped in water.
 *
 * Built from a strongly domain-warped turbulence field: a main *billow* term
 * for the soft folded mass of a spreading cloud, plus a finer second pass
 * for the wisps streaming off it. The frequencies are integers on purpose —
 * fbm2 wraps at whole units, so integer coordinates make the tile seamless,
 * and they stay low because at this tile size higher octaves read as static
 * rather than as ink.
 */
export function cloudTile() {
  if (CLOUD) return CLOUD;
  const S = CLOUD_SIZE;
  const rng = mulberry32(0x9d2c5680);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const img = g.createImageData(S, S);

  const w1 = fbm2(rng, 2);
  const w2 = fbm2(rng, 2);
  const bill = fbm2(rng, 3);
  const fine = fbm2(rng, 3);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;

      /* strong warp: the whole character of the sheet is in these two
         fields displacing everything downstream of them */
      const a1 = w1(u, v);
      const a2 = w2(u + 5.1, v - 2.3);

      /* the cloud mass */
      const n = bill(u + a1 * 0.9, v + a2 * 0.9);
      const main = Math.pow(clamp01(n * 2.05 - 0.72), 1.75);

      /* the wisps: a finer pass through the same warp, faint and sparse */
      const m = fine(u * 2 + a1 * 1.4 + 3.3, v * 2 + a2 * 1.4 - 1.1);
      const wisps = Math.pow(clamp01(m * 2.0 - 0.78), 2.1) * 0.40;

      const a = clamp01(main + wisps);

      const i = (y * S + x) * 4;
      img.data[i] = 7;
      img.data[i + 1] = 9;
      img.data[i + 2] = 11;
      img.data[i + 3] = (a * 255) | 0;
    }
  }
  g.putImageData(img, 0, 0);
  CLOUD = cv;
  return cv;
}
