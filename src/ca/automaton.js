/* ═══════════════════════════════════════════════════════════════════════════
   A two-colour, radius-1 totalistic cellular automaton on a typed array.

   Plain and direct: the grid is a Uint8Array, the neighbourhood sum is nine
   array reads, and the transition table is an 18-entry lookup. A patch of
   96² for 34 steps is roughly 300k cell updates — about a millisecond, which
   is why this does not need a worker. The glyph draw that consumes it takes
   three seconds.

   Edges read as empty rather than wrapping. Each patch is built with a margin
   of dead cells around the growth area precisely so the automaton never has
   its behaviour altered by meeting the grid edge — without that margin the
   reachable region picks up a hard circular boundary and the growth reads as
   a disc instead of as ink.
   ═══════════════════════════════════════════════════════════════════════════ */

import { ruleTable } from './rules.js';

/**
 * One generation.
 *
 * Written out longhand with the edge handling hoisted out of the inner loop.
 * The obvious form — a closure `at(x,y)` that bounds-checks on every read —
 * costs roughly 30ms for a couple of deposits' worth of glyphs, which is a
 * visible hitch at the moment of a click. Hoisting the row pointers and
 * testing the interior column separately brings it to a couple of
 * milliseconds.
 */
export function stepInto(a, b, w, h, table, keep) {
  for (let y = 0; y < h; y++) {
    const rowC = y * w;
    const rowU = (y === 0 ? h - 1 : y - 1) * w;
    const rowD = (y === h - 1 ? 0 : y + 1) * w;

    for (let x = 0; x < w; x++) {
      const i = rowC + x;
      if (keep !== null && keep[i] === 0) { b[i] = 0; continue; }

      let n;
      if (x === 0) {
        const xl = w - 1, xr = 1;
        n = a[rowU + xl] + a[rowU] + a[rowU + xr]
          + a[rowC + xl] + a[rowC + xr]
          + a[rowD + xl] + a[rowD] + a[rowD + xr];
      } else if (x === w - 1) {
        const xl = w - 2, xr = 0;
        n = a[rowU + xl] + a[rowU + x] + a[rowU + xr]
          + a[rowC + xl] + a[rowC + xr]
          + a[rowD + xl] + a[rowD + x] + a[rowD + xr];
      } else {
        const xm = x - 1, xp = x + 1;
        n = a[rowU + xm] + a[rowU + x] + a[rowU + xp]
          + a[rowC + xm] + a[rowC + xp]
          + a[rowD + xm] + a[rowD + x] + a[rowD + xp];
      }
      b[i] = table[9 * a[i] + n];
    }
  }
}

/**
 * Run the automaton for `steps` generations.
 *
 * @param {number} rule      Wolfram totalistic rule number
 * @param {Uint8Array} seed  initial cells, w*h, 1 = ink
 * @param {number} w
 * @param {number} h
 * @param {number} steps
 * @param {Uint8Array|null} [keep]  reach mask; cells where keep[i] === 0 are
 *   forced dry after every step. This is the reach budget — without it these
 *   rules are self-sustaining and flood the frame within a dozen steps.
 * @returns {Uint8Array} the final grid; `seed` is left untouched
 */
export function grow(rule, seed, w, h, steps, keep = null) {
  const table = ruleTable(rule);
  let a = seed;
  let b = new Uint8Array(w * h);
  for (let s = 0; s < steps; s++) {
    stepInto(a, b, w, h, table, keep);
    const t = a; a = b; b = t;
  }
  return a;
}
