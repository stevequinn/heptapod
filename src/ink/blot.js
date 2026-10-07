/* ═══════════════════════════════════════════════════════════════════════════
   The blot.

   Where the ink is heavy it is a compact, dense, irregular blob dropped on the
   ring — a splat, not a swelling of the stroke.

   Two earlier models are worth recording, because both were reasonable and both
   were wrong in the same way: they treated the heavy regions as part of the
   stroke.

     1. "The stroke's width grows to ten times the hairline and tapers over a
        quarter of the circle." The result read as a glump stuck to a wire. The
        error was architectural.
     2. "The stroke swells gently into a tapered blade over 60 to 100 degrees of
        arc." This is much closer to right, and it survived several rounds of
        measurement, because the *statistics* of a tapered blade and of a thin
        circle with blots on it overlap almost completely. What kills it is
        looking at all 38 frames at once: the circle is visibly a circle, of
        even weight, in every one of them, and the heavy regions are visibly
        separate things sitting on it.

   So the blot is modelled as what it looks like. It is short — most span 25 to
   45 degrees — and deep, five to twenty times the ring's own weight, with an
   irregular lobed outline.

   Widths come back as half-widths in ring radii, in the units the stroke
   consumes. Nothing is remapped later.
   ═══════════════════════════════════════════════════════════════════════════ */

import { BLOT } from '../config.js';
import { fbm1, mulberry32, rr, clamp01 } from '../lib/math.js';

/**
 * The half-width of one blot, sampled across its arc.
 *
 * The outline is a parabola raised to `BLOT.shoulder`: blunt-topped, because a
 * splat is, and falling to nothing at both ends so the blot merges into the
 * ring with no seam. On top of that goes lumpiness at two scales — a clean
 * parabola is an ellipsoid, and an ellipsoid is instantly readable as a drawn
 * shape.
 *
 * @param {object} o
 * @param {number} o.halfSpan   angular half-span of this blot, radians
 * @param {number} o.ringHalf   the ring's half-width
 * @param {number} o.strength   0..1-ish, how heavy this blot is
 * @param {function} o.rng
 * @param {number} [o.samples]
 * @returns {{widths: Float32Array, peak: number, mid: number}}
 */
export function blotProfile({ halfSpan, ringHalf, strength = 1, rng, samples = 64 }) {
  const S = samples;
  const w = new Float32Array(S);

  const lo = fbm1(mulberry32((rng() * 4294967296) >>> 0), 2);
  const hi = fbm1(mulberry32((rng() * 4294967296) >>> 0), 2);
  const p0 = rng() * 90, p1 = rng() * 90;

  /* Where the blot sits within its own arc. Off-centre often, because a blot
     dropped by hand does not land symmetrically, and a symmetric one is a
     further cue that a shape is generated. */
  const mid = 0.42 + 0.16 * rng();

  const peakMul = rr(rng, BLOT.peak[0], BLOT.peak[1])
                * (0.72 + 0.28 * clamp01(strength / 1.3));
  const peak = ringHalf * peakMul;

  let maxW = 0;
  for (let i = 0; i < S; i++) {
    const t = i / (S - 1);

    const d = clamp01(Math.abs(t - mid) / 0.5);
    const env = Math.pow(1 - d * d, BLOT.shoulder);

    /* Structure: a slow term that makes the blot lopsided and a faster one that
       scallops its outline. Both vary *along* the blot, so it is not a scaled
       copy of one profile. */
    const mod = 1
      + BLOT.lumpiness * (lo(t * BLOT.lumpFreq * 0.55 + p0) - 0.5) * 1.5
      + BLOT.lumpiness * 0.55 * (hi(t * BLOT.lumpFreq * 1.9 + p1) - 0.5) * 1.5;

    w[i] = Math.max(0, peak * env * mod);
    if (w[i] > maxW) maxW = w[i];
  }

  return { widths: w, peak: maxW, mid };
}
