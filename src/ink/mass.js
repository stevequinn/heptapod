/* ═══════════════════════════════════════════════════════════════════════════
   The ink mass.

   Where the stroke is heavy it is a *blob of ink*, not a thick line, and this
   is where that blob is described.

   This module used to be a cellular automaton. Worth recording why it is not
   any more, because the automaton is the part of the project with the strongest
   pull and the case against it is easy to relitigate:

   The reference figures are the film's logograms — isolated, thresholded and
   captioned. They are the *input* to Wolfram's ca-01.nb, which imports the
   JPEGs and runs CellularAutomaton on them; his own exported .mov files are
   the output and they are labyrinthine self-similar blobs with no ring and no
   filaments. The two look nothing alike. So the automaton cannot be a model of
   the film's ink, and it was being used to derive the mass's width by measuring
   how deep a CA grew perpendicular to the ring — which meant the mass was a CA
   silhouette in disguise, and read like one.

   What the automaton supplied was variety. Noise supplies variety too, more
   cheaply, and it can be shaped. So the mass is modelled directly as what the
   references show: a broad, lumpy, smooth-shouldered swelling.
   ═══════════════════════════════════════════════════════════════════════════ */

import { MASS } from '../config.js';
import { fbm1, mulberry32, rr, clamp01 } from '../lib/math.js';

/**
 * The half-width of one mass, sampled across its arc.
 *
 * The shape is a half-sine raised to `MASS.shoulder`, not a Gaussian. A
 * Gaussian is the obvious choice and it is wrong: it is far too pointy, and the
 * references have broad, nearly flat shoulders with a fall-off at the ends —
 * which is what a low exponent on a sine gives.
 *
 * On top of that goes lumpiness at two scales, which matters more than it
 * sounds. A clean half-sine produces an ellipsoidal blob, and an ellipsoid is
 * instantly readable as a drawn shape; the references' masses have scalloped
 * outlines and internal structure.
 *
 * Widths come back as **half-widths in ring radii**, already in the units the
 * stroke consumes. They are not a "measurement" to be remapped later — that
 * indirection existed only so a cellular automaton could be plugged in, and
 * removing it removes a whole layer where the units could be got wrong. (They
 * were: `CA.reach` and `BRUSH.swellMax` multiplied into each other once and put
 * the mass at 0.9 R, nearly as wide as the ring.)
 *
 * @param {object} o
 * @param {number} o.halfSpan   angular half-span of this mass, radians
 * @param {number} o.hairline   the stroke's quiet half-width
 * @param {number} o.strength   0..1-ish, how heavy this deposit is
 * @param {number} o.samples
 * @returns {{widths: Float32Array, peak: number}}
 */
export function massProfile({ halfSpan, hairline, strength = 1, rng, samples = 64 }) {
  const S = samples;
  const w = new Float32Array(S);

  const lo = fbm1(mulberry32((rng() * 4294967296) >>> 0), 2);
  const hi = fbm1(mulberry32((rng() * 4294967296) >>> 0), 2);
  const p0 = rng() * 90, p1 = rng() * 90;

  /* Where the blob sits within its own arc. Off-centre often, because a hand
     does not place a blob symmetrically, and a symmetric blob is another cue
     that a shape is generated. */
  const mid = 0.42 + 0.16 * rng();

  const peakMul = rr(rng, MASS.peak[0], MASS.peak[1])
                * (0.55 + 0.45 * clamp01(strength / 1.3));
  const peak = hairline * peakMul;

  const lump = MASS.lumpiness;
  const f = MASS.lumpFreq;

  let maxW = 0;
  for (let i = 0; i < S; i++) {
    const t = i / (S - 1);

    /* The envelope: a parabola, which is what a blade is. Flat along the top
       where the brush was pressed, and tapering to *points* at both ends.

       A raised cosine is the obvious choice and it ends blunt: its slope is zero
       at the arc's edge, so the mass stops rather than tapering, and every
       blade in the references tapers. `(1 - d^2)` has a finite slope at d = 1,
       which is what makes an end read as a point. */
    const d = clamp01(Math.abs(t - mid) / 0.5);
    const env = Math.pow(1 - d * d, MASS.shoulder);

    /* Structure: a slow term that makes the blob lopsided, and a faster one
       that scallops its outline. Both vary *along* the blob, so the mass is not
       a scaled copy of one profile. */
    const mod = 1
      + lump * (lo(t * f * 0.55 + p0) - 0.5) * 1.5
      + lump * 0.55 * (hi(t * f * 1.9 + p1) - 0.5) * 1.5;

    w[i] = Math.max(0, peak * env * mod);
    if (w[i] > maxW) maxW = w[i];
  }

  return { widths: w, peak: maxW };
}
