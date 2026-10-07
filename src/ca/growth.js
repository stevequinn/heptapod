/* ═══════════════════════════════════════════════════════════════════════════
   Turning automaton growth into ink.

   Three jobs:

   1. Build the reach mask. Wolfram's rules never stop on their own, so the
      growth is confined to a disc around the ink deposit — with the disc's
      boundary pushed around by fbm, because a clean circle is instantly
      readable as artificial and an ink boundary is never round.

   2. Run the automaton (see automaton.js).

   3. Trace the result into filaments. A CA is a grid and ink is not, so the
      grid has to be dissolved before the growth will read as ink at all.
      Each surviving cell emits one short hair pointing outward from the
      deposit, jittered and tapered, weighted by how exposed the cell is: a
      cell buried in a dense mass emits almost nothing, a cell on a loose edge
      emits a long hair. The result is fuzz and torn edges rather than
      squares.

   Everything here is in glyph-local space, where the ring radius is 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { CA } from '../config.js';
import { grow } from './automaton.js';
import { pickRule } from './rules.js';
import { fbm2, TAU } from '../lib/math.js';

/**
 * Grow one deposit's fibrous burst.
 *
 * Geometry: the deposit sits at the centre of a patch of CA cells, and one
 * cell is `CA.cell` ring radii across. The patch is sized from those two
 * numbers rather than the other way round, so the growth resolution is a free
 * parameter — which matters, because at coarse cell sizes the automaton's own
 * grid becomes visible in the ink and the glyph reads as pixels.
 *
 * @param {object} o
 * @param {number} o.angle      where on the ring the deposit sits, radians
 * @param {number} o.spread     deposit seed radius, in ring radii
 * @param {function} o.rng      seeded PRNG
 * @param {number} o.seed       glyph seed, so the fbm displacement is stable
 * @param {number} [o.strength] 0..1, how heavy this deposit reads
 * @returns {{strokes: Array, rule: number, cells: number}}
 */
export function growDeposit({ angle, spread, rng, seed, strength = 1 }) {
  const P = CA.patch;
  const C = (P - 1) / 2;
  const cell = CA.cell;                 // ring radii per cell
  const reachCells = CA.reach / cell;

  const kx = C, ky = C;                 // the deposit sits at the centre
  const seedR = Math.max(2, spread / cell);

  /* ---- 1. reach mask ---------------------------------------------------
     Two octaves: a low frequency that gives the burst a lopsided overall
     shape, and a high frequency that frays the individual filaments where
     they reach the limit. A clean circle would be instantly readable as
     artificial.

     The displacement depends only on the angle, so it is evaluated into a
     small lookup and indexed per pixel. Evaluating the fbm per pixel instead
     costs more than the automaton run itself — the noise is five octaves over
     a quarter of a million samples, to produce a value that is constant along
     each ray. */
  const lo = fbm2(mulberry32(seed * 2654435761 + 17), 3);
  const hi = fbm2(mulberry32(seed * 40503 + 991), 2);
  const LUTS = 512;
  const limLut = new Float32Array(LUTS);
  const wob = CA.wobble * (0.35 + 0.65 * strength);
  for (let i = 0; i < LUTS; i++) {
    const a = (i / LUTS) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const r0 = lo(ca * 0.9 + 4.1, sa * 0.9 + 7.3) - 0.5;
    const r1 = hi(ca * 3.4 + 1.7, sa * 3.4 - 2.9) - 0.5;
    limLut[i] = reachCells * (1 + wob * (r0 * 1.5 + r1 * 0.7));
  }

  const keep = new Uint8Array(P * P);
  const k2 = LUTS / TAU;
  for (let y = 0; y < P; y++) {
    const dy = y - ky;
    const row = y * P;
    for (let x = 0; x < P; x++) {
      const dx = x - kx;
      const d2 = dx * dx + dy * dy;
      let i = (Math.atan2(dy, dx) * k2) | 0;
      if (i < 0) i += LUTS;
      keep[row + x] = d2 <= limLut[i] * limLut[i] ? 1 : 0;
    }
  }

  /* ---- 2. seed and run ------------------------------------------------- */
  const grid = new Uint8Array(P * P);
  for (let y = 0; y < P; y++)
    for (let x = 0; x < P; x++)
      if (Math.hypot(x - kx, y - ky) < seedR) grid[y * P + x] = 1;

  const rule = pickRule(rng);
  const out = grow(rule, grid, P, P, CA.steps, keep);

  /* ---- 3. trace to filaments and pools --------------------------------- */
  const { strokes, pools } = trace(out, P, kx, ky, cell, angle, rng, strength);

  let cells = 0;
  for (let i = 0; i < out.length; i++) cells += out[i];

  return { strokes, pools, rule, cells };
}

/**
 * Trace ink cells into hairs and pools.
 *
 * The pools matter as much as the hairs. Filaments alone read as dust or
 * sand — a spray of faint, evenly-weighted specks — because nothing in them
 * is actually *dark*. A logogram deposit is a mass of wet ink with hairs
 * radiating off it, so the well-surrounded cells of the automaton's interior
 * are emitted as filled, irregular pools and the hairs go on top.
 *
 * `angle` is the deposit's angle on the ring; it decides which side of each
 * hair counts as "outward", because a burst is dense on the side away from
 * the ring and thins on the side that has to stay attached to the stroke.
 */
function trace(grid, P, kx, ky, cell, angle, rng, strength) {
  const at = (x, y) => (x < 0 || y < 0 || x >= P || y >= P ? 0 : grid[y * P + x]);
  const strokes = [];
  const pools = [];
  const half = 0.34 * cell * CA.detail;
  const ux0 = Math.cos(angle), uy0 = Math.sin(angle);

  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      if (!grid[y * P + x]) continue;

      let ink = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++)
          if ((ox || oy) && at(x + ox, y + oy)) ink++;
      const exposed = 8 - ink;               // 0 buried, 8 fully exposed

      /* Jitter the origin inside its cell as well as the direction. Without
         this every hair starts on the lattice and the burst carries a visible
         cross-hatch moire straight out of the automaton's grid. */
      const ox = (rng() - 0.5) * cell * 1.1;
      const oy = (rng() - 0.5) * cell * 1.1;
      const dx = (x - kx) * cell + ox, dy = (y - ky) * cell + oy;

      /* A pool: well surrounded by ink, so this is inside the mass. */
      if (exposed <= 2) {
        const rad = cell * (1.15 + rng() * 0.7) * (1 - exposed * 0.10);
        pools.push({
          x: dx, y: dy, r: rad,
          lobes: 5 + Math.floor(rng() * 3),
          rough: 0.34 + rng() * 0.32,
          rot: rng() * TAU,
          // deliberately light: the pools are mass, but stacking dozens of
          // near-opaque ones gives a clump of black berries rather than a
          // smear of ink
          a: (0.16 + 0.24 * strength) * (0.55 + 0.6 * rng()),
        });
        continue;
      }

      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;
      const outward = ux * ux0 + uy * uy0 > 0;

      /* Jitter the direction, but bias it back toward radial. Fully random
         directions give a uniform fuzz ball; fully radial directions give a
         starburst. Exposed cells keep more of their radial bias, which is what
         makes the fringe spray outward while the interior stays loose. */
      const bias = outward ? 0.40 : 0.72;
      const a = Math.atan2(uy, ux) + (rng() - 0.5) * TAU * (1 - bias);
      const px = Math.cos(a), py = Math.sin(a);

      const len = cell * (1.5 + 2.6 * (exposed / 8)) * (0.5 + 0.9 * rng())
                * (outward ? 1 : 0.5);
      const w = half * (0.32 + 0.80 * (1 - exposed / 8));

      strokes.push({
        x0: dx, y0: dy,
        x1: dx + px * len, y1: dy + py * len,
        w,
        a: (0.09 + 0.34 * strength) * (0.25 + 0.75 * exposed / 8)
         * (0.65 + 0.55 * rng()) * (outward ? 1 : 0.45),
        curl: (rng() - 0.5) * 0.55,
      });
    }
  }
  return { strokes, pools };
}

/**
 * The deposit without the automaton: a fibrous burst of hair-thin filaments
 * spraying from a dense knot, drawn procedurally.
 *
 * Kept because it is what the automaton tends to converge on, so the two read
 * as the same species — and because it is the fallback when CA growth is
 * switched off.
 */
export function proceduralDeposit({ angle, spread, rng, strength = 1 }) {
  const strokes = [];
  const pools = [];
  const bx = Math.cos(angle), by = Math.sin(angle);

  // the same wet mass the automaton version produces, so the two read as the
  // same species
  const core = spread * 1.15;
  for (let i = 0; i < 5 + Math.round(rng() * 3); i++) {
    const a = rng() * TAU, d = core * 0.45 * rng();
    pools.push({
      x: Math.cos(a) * d, y: Math.sin(a) * d,
      r: core * (0.55 + rng() * 0.5),
      lobes: 5 + Math.floor(rng() * 3),
      rough: 0.28 + rng() * 0.30,
      rot: rng() * TAU,
      a: (0.30 + 0.42 * strength) * (0.55 + 0.6 * rng()),
    });
  }
  const tx = Math.cos(angle + Math.PI / 2), ty = Math.sin(angle + Math.PI / 2);
  const n = Math.round(12 + 15 * strength + rng() * 8);
  for (let i = 0; i < n; i++) {
    // Tangential bias: uniform radial angles produce a "porcupine", which is
    // exactly the look to avoid. Real splatter hugs the stroke it came from.
    const side = rng() < 0.5 ? -1 : 1;
    const dir = angle + side * (0.35 + rng() * 1.5)
              + (rng() < 0.2 ? (rng() - 0.5) * 1.6 : 0);
    const len = spread * (1.4 + rng() * 3.2) * (0.45 + 0.55 * strength);
    const curl = (rng() - 0.5) * 0.8;
    const dx = Math.cos(dir), dy = Math.sin(dir);
    strokes.push({
      x0: bx + tx * (rng() - 0.5) * spread * 0.4,
      y0: by + ty * (rng() - 0.5) * spread * 0.4,
      x1: bx + dx * len + Math.cos(dir + curl) * len * 0.22,
      y1: by + dy * len + Math.sin(dir + curl) * len * 0.22,
      w: spread * (0.20 + rng() * 0.28),
      a: (0.10 + 0.40 * strength) * (0.45 + 0.55 * rng()),
      curl: (rng() - 0.5) * 0.4,
    });
  }
  return { strokes, pools };
}

/** local PRNG so a glyph's fbm depends only on its seed */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
