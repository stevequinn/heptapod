/* ═══════════════════════════════════════════════════════════════════════════
   The faithful version.

   ca-01.nb seeds the automaton from the *entire* binarised logogram and runs it
   for 700 steps:

     CellularAutomaton[{rule, {2,{{2,2,2},{2,1,2},{2,2,2}},{1,1}}, 0},
                       {ImageData[ImagePad[ColorNegate[Binarize[
                         ImageResize[logogram,100]]],10,Black]], 0}, 700]

   So the ring is not decoration around the growth — the ring *is* the initial
   condition. This module does that: it rasterises the drawn glyph into a grid,
   runs one of Wolfram's rules over the whole thing, and traces the cells that
   are new.

   What you get is not the film's splatter. It is self-similar, symmetric
   branching growth spreading out from the entire circle, which is what his
   exports in the repository actually show. It is here so the two readings can
   be compared rather than argued about — see `main.js`'s G key.

   Step count is a compromise. 700 steps at this grid is ~40ms, which is a
   visible stall on click against a three-second draw; 150 gives the same
   character because these rules reach their visual form early and then churn.
   ═══════════════════════════════════════════════════════════════════════════ */

import { CA } from '../config.js';
import { grow } from './automaton.js';
import { pickRule } from './rules.js';
import { TAU, mulberry32, fbm1 } from '../lib/math.js';

/** grid across the glyph, in cells. 128 puts a cell just under 0.02 ring radii
 *  at a half-extent of 1.25, which is fine — the trace randomises hair origins
 *  within the cell, so the lattice does not show. */
const N = 128;
const EXTENT = 1.25;               // half-width of the grid, in ring radii
const SCALE = N / (2 * EXTENT);    // cells per ring radius
const CENTRE = N / 2;

/* One reusable scratch canvas: rasterising the seed is the only DOM-ish work
   here, and allocating a canvas per glyph is not free. */
let scratch = null;
function scratchCtx() {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = scratch.height = N;
  }
  const c = scratch.getContext('2d', { willReadFrequently: true });
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, N, N);
  return c;
}

/**
 * Rasterise a glyph's ring and deposits into a binary grid.
 *
 * Drawn rather than evaluated analytically: the nearest-point test over 216
 * path samples for every one of 16k cells is ~3.5M distance computations, and
 * a canvas stroke plus one small readback is an order of magnitude cheaper.
 *
 * @param {object} glyph
 * @returns {Uint8Array} N*N, 1 = ink
 */
export function rasteriseGlyph(glyph) {
  const c = scratchCtx();
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.translate(CENTRE, CENTRE);
  c.scale(SCALE, -SCALE);        // glyph y is down, grid y is up

  for (const op of glyph.ops) {
    if (!op.isRing) continue;   // only the stroke itself is the seed
    op.draw(c);
  }

  // deposits are part of the logogram's ink, so they seed too
  for (const b of glyph.blots) {
    c.beginPath();
    c.arc(Math.cos(b.a), Math.sin(b.a), b.spread * 1.6, 0, TAU);
    c.fill();
  }

  const px = c.getImageData(0, 0, N, N).data;
  const grid = new Uint8Array(N * N);
  for (let i = 0, p = 3; i < grid.length; i++, p += 4) {
    grid[i] = px[p] > 40 ? 1 : 0;
  }
  return grid;
}

/**
 * Run a rule over a rasterised glyph and return strokes for the new ink.
 *
 * @param {Uint8Array} seed  the rasterised logogram
 * @param {function} rng    seeded PRNG
 * @param {number} seedNum  glyph seed, for the trace jitter
 * @returns {{strokes: Array, pools: Array, rule: number, fresh: number}}
 */
export function growWhole(seed, rng, seedNum) {
  const rule = pickRule(rng);
  const out = grow(rule, seed, N, N, CA.wholeSteps, null);

  /* Only cells that were not ink in the seed. Without this the result is just
     the ring redrawn in a different texture, which tells you nothing — the
     interesting thing is what the automaton added. */
  const fresh = new Uint8Array(N * N);
  let count = 0;
  for (let i = 0; i < fresh.length; i++) {
    if (out[i] && !seed[i]) { fresh[i] = 1; count++; }
  }

  const noise = fbm1(mulberry32(seedNum ^ 0x5bf03635), 3);
  const strokes = [];
  const pools = [];
  const cell = 1 / SCALE;                 // one cell, in ring radii
  const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N ? 0 : fresh[y * N + x]);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!fresh[y * N + x]) continue;

      let nb = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++)
          if ((ox || oy) && at(x + ox, y + oy)) nb++;
      const exposed = 8 - nb;

      // grid -> glyph space, y up, and randomised inside the cell
      const gx = (x - CENTRE + (rng() - 0.5) * 1.1) / SCALE;
      const gy = -(y - CENTRE + (rng() - 0.5) * 1.1) / SCALE;

      if (exposed <= 2) {
        pools.push({
          x: gx, y: gy,
          r: cell * (1.1 + rng() * 0.7),
          lobes: 5 + Math.floor(rng() * 3),
          rough: 0.34 + rng() * 0.32,
          rot: rng() * TAU,
          a: (0.10 + 0.16 * noise(x * 0.05, y * 0.05)) * (0.5 + 0.6 * rng()),
        });
        continue;
      }

      // direction biased along the growth, which here is outward from the ring
      const r = Math.hypot(gx, gy) || 1e-4;
      const bias = 0.30 + 0.45 * (exposed / 8);
      const a = Math.atan2(gy, gx) + (rng() - 0.5) * TAU * (1 - bias);
      const len = cell * (1.6 + 3.0 * (exposed / 8)) * (0.5 + 0.9 * rng());
      strokes.push({
        x0: gx, y0: gy,
        x1: gx + Math.cos(a) * len, y1: gy + Math.sin(a) * len,
        w: cell * 0.30 * (0.4 + 0.9 * (1 - exposed / 8)),
        a: (0.05 + 0.16 * noise(x * 0.03, y * 0.03)) * (0.25 + 0.75 * exposed / 8),
        curl: (rng() - 0.5) * 0.6,
      });
      void r;
    }
  }

  return { strokes, pools, rule, fresh: count };
}

export const WHOLE = { N, EXTENT, SCALE };
