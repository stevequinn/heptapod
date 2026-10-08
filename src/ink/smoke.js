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
 * A single broad field, gently warped, gated by a second low-frequency field:
 * clear water with a few large folded masses drifting in it, not a tinted
 * disc. Every field is one octave. Earlier multi-octave sheets carried detail
 * down at the pixel scale, and once two enlarged copies of one were laid over
 * each other the mark read as gravel rather than ink; the writer now crops
 * and zooms this sheet instead of asking it to hold every scale at once.
 *
 * The frequencies are integers on purpose — fbm2 wraps at whole units, so
 * integer coordinates make the tile seamless.
 */
export function cloudTile() {
  if (CLOUD) return CLOUD;
  const S = CLOUD_SIZE;
  const rng = mulberry32(0x9d2c5680);
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');

  const wx = fbm2(rng, 1);
  const wy = fbm2(rng, 1);
  const bill = fbm2(rng, 1);
  const dens = fbm2(rng, 1);

  const a = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;

      /* the same gentle warp on everything, so the gate and the mass are
         folded through each other rather than merely multiplied */
      const ax = wx(u, v) - 0.5;
      const ay = wy(u + 5.1, v - 2.3) - 0.5;

      const n = bill(u + ax * 0.9, v + ay * 0.9);
      const d = dens(u * 0.62 + ax * 0.7 + 1.7, v * 0.62 + ay * 0.7 - 4.2);
      const gate = smoothstep(0.28, 0.60, d);
      const mass = smoothstep(0.44, 0.60, n);

      a[y * S + x] = clamp01(mass * (0.40 + 0.80 * gate));
    }
  }

  /* Two 1-2-1 passes. The sheet is always drawn enlarged, so all this removes
     is pixel gravel that would otherwise read as static. */
  let src = a;
  const tmp = new Float32Array(S * S);
  const at = (x, y) => ((((y % S) + S) % S) * S) + (((x % S) + S) % S);
  for (let p = 0; p < 2; p++) {
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        tmp[y * S + x] = (src[at(x - 1, y)] + 2 * src[y * S + x] + src[at(x + 1, y)]) / 4;
      }
    }
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        src[y * S + x] = (tmp[at(x, y - 1)] + 2 * tmp[y * S + x] + tmp[at(x, y + 1)]) / 4;
      }
    }
  }

  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    img.data[o] = 7;
    img.data[o + 1] = 9;
    img.data[o + 2] = 11;
    img.data[o + 3] = (clamp01(src[i]) * 255) | 0;
  }
  g.putImageData(img, 0, 0);
  CLOUD = cv;
  return cv;
}
