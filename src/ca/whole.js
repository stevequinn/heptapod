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
import { TAU } from '../lib/math.js';

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

/** grid cell -> glyph-local xy, matching measureProfile's expectation */
export function project(x, y) {
  return [(x - CENTRE + 0.5) / SCALE, -(y - CENTRE + 0.5) / SCALE];
}

/**
 * Rasterise a logogram seed into a binary grid.
 *
 * Drawn rather than evaluated analytically: the nearest-point test over 216
 * path samples for every one of 16k cells is ~3.5M distance computations, and
 * a canvas stroke plus one small readback is an order of magnitude cheaper.
 *
 * The seed is the *plain* glyph — a thin ring and a disc at each deposit — not
 * the finished one. It has to be, because in this mode the automaton's
 * measurement is what makes the stroke heavy: seeding it from an already-fat
 * ring would just redraw the ring in a different texture.
 *
 * @param {object} o
 * @param {Array<{x:number,y:number}>} o.path  ring samples
 * @param {number} o.hairline  seed stroke half-width, ring radii
 * @param {Array<{a:number, spread:number}>} o.blots
 * @returns {Uint8Array} N*N, 1 = ink
 */
export function rasteriseSeed({ path, hairline, blots }) {
  const c = scratchCtx();
  c.fillStyle = '#fff';
  c.strokeStyle = '#fff';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.translate(CENTRE, CENTRE);
  c.scale(SCALE, -SCALE);        // glyph y is down, grid y is up

  c.beginPath();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i === 0) c.moveTo(p.x, p.y); else c.lineTo(p.x, p.y);
  }
  c.lineWidth = Math.max(1.2, hairline * SCALE * 2);
  c.stroke();

  for (const b of blots) {
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
 * Run one of Wolfram's rules over the whole rasterised glyph.
 *
 * One rule for the entire logogram, which is what makes this mode different in
 * kind from `deposit`: the deposits' blades are all produced by the same rule
 * on the same field, so they are correlated with each other instead of being
 * independent accidents. Wolfram's exports show self-similar growth spreading
 * from the entire circle, and this is the version that does that.
 *
 * @param {Uint8Array} seed
 * @param {function} rng
 * @returns {{grid: Uint8Array, rule: number, fresh: number}}
 */
export function growGrid(seed, rng) {
  const rule = pickRule(rng);
  const out = grow(rule, seed, N, N, CA.wholeSteps, null);

  /* Only cells that were not ink in the seed. Without this the measurement
     just redraws the ring in a different texture, which tells you nothing —
     the interesting thing is what the automaton added. */
  let fresh = 0;
  for (let i = 0; i < out.length; i++) if (out[i] && !seed[i]) fresh++;

  return { grid: out, fresh, rule };
}

export const WHOLE = { N, EXTENT, SCALE };
