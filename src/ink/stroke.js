/* ═══════════════════════════════════════════════════════════════════════════
   The stroke.

   A logogram is a thin circle of near-constant weight, with blots of ink
   dropped on it. This module draws the circle. blot.js describes what lands on
   it, offshoots.js what leaves it.

   The circle is the point, and getting it wrong is what made every earlier
   version look wrong in a way that was hard to name. It is present in all 38
   reference frames. It is even. It is complete, or very nearly so — a break in
   it is the exception, and a clean break rather than a fade. Versions of this
   file have modulated its weight heavily to produce the heavy regions, and
   every one of them produced a ring that looked like it faded out, because it
   did.

   It has also been drawn at more than twice the right weight for most of this
   project's life: 0.021 R for the half-width, derived from a screenshot early
   on and never re-derived, with every later measurement normalised against it.
   Measured properly, on the full-resolution frames, it is 0.015 to 0.022 R
   *across* — the thinnest line in the whole corpus.

     ringProfile   the circle, the blots on it, and where it lifts off the glass
     ringBand      the mark itself, as a band whose edges follow that profile
     striations    how each lengthwise streak is inked — the dry-brush gaps
     dryTexture    fine streaks along the mark, and a torn edge

   All geometry is in glyph-local space: the nominal ring sits at radius 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, STROKE } from '../config.js';
import { TAU, angDiff, clamp01, fbm1, mulberry32, ri, smoothstep } from '../lib/math.js';

/* ═══ the width profile ═════════════════════════════════════════════════ */

/**
 * Half-width for every sample around the ring.
 *
 * Three contributions, in ascending order of authority:
 *
 *   1. the circle, with the twelve-sector ink profile supplying its unevenness
 *   2. whichever blot covers this angle, taking the maximum — the circle runs
 *      *through* a blot rather than being replaced by it
 *   3. the lift-off, where the circle leaves the glass
 *
 * Blot widths arrive already in half-width units, so there is no remapping
 * step. That is deliberate — the remap existed only to translate a cellular
 * automaton's measurements, and it was where the units got conflated.
 *
 * @param {Array<{angle:number, halfSpan:number, widths:Float32Array}>} blots
 * @param {Float32Array} sectorProfile  per-sector ink weight, 0..1
 * @param {number} ringHalf             the circle's half-width, ring radii
 * @param {number} samples
 * @param {function(number):number} [flowAt]  0..1 where the circle has lifted
 * @returns {{widths: Float32Array, peak: number}}
 */
export function ringProfile({ blots, sectorProfile, ringHalf, samples, flowAt }) {
  const M = sectorProfile.length;
  const widths = new Float32Array(samples);
  /* The circle's own small unevenness. Deliberately small: the reference rings
     are even, and a wobbly line reads as a wobbly line. */
  const vary = GLYPH.ringVariation;

  let peak = ringHalf;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;

    // 1. the circle, with the twelve-sector profile supplying its unevenness
    const u = (a / TAU) * M;
    const i0 = Math.floor(u) % M;
    const f = u - Math.floor(u);
    const sp = sectorProfile[i0]
             + (sectorProfile[(i0 + 1) % M] - sectorProfile[i0]) * f * f * (3 - 2 * f);
    let w = ringHalf * (1 - vary * 0.5 + vary * sp);

    // 2. the blots, on top. They are the heavy regions; the circle runs through
    //    them rather than being replaced by them.
    for (const b of blots) {
      const dd = angDiff(a, b.angle);
      if (Math.abs(dd) > b.halfSpan) continue;
      const t = (dd / b.halfSpan + 1) * 0.5;
      const k = Math.max(0, Math.min(b.widths.length - 1,
        Math.round(t * (b.widths.length - 1))));
      if (b.widths[k] > w) w = b.widths[k];
    }

    /* 3. Where the limb lifted. Rare, and a clean break rather than a fade —
       the reference rings do not thin out at the edges of their gaps, they
       simply stop. */
    if (flowAt) w *= flowAt(a);

    widths[i] = w;
    if (w > peak) peak = w;
  }

  return { widths, peak };
}

/* ═══ the band ══════════════════════════════════════════════════════════ */

/**
 * The stroke as a band whose two edges follow the width profile.
 *
 * The inner edge sits closer in than the outer edge pushes out, and the
 * asymmetry grows with the local width: ink dropped on a circle sits on it
 * rather than centred in it, and a heavy blot spills outward more than inward
 * — which is what the reference blots do.
 *
 * @param {Array<{x,y,nx,ny,u}>} path  ring samples in glyph-local space
 * @param {Float32Array} widths         per-sample half-width
 * @param {number} peak                 the stroke's widest half-width, which
 *   sets how far the band bulges outward under load
 */
export function ringBand({ path, widths, seed, peak }) {
  const n = path.length;
  const outer = new Array(n);
  const inner = new Array(n);

  /* Four scales of edge irregularity, and they do different jobs: `lobes` gives
     a blot big rounded scallops, which is what a loaded brush leaves;
     `ragged` and `tear` break the boundary up; `fine` is the sawtooth of
     individual bristle tips catching the glass.

     The frequencies matter as much as the amplitudes. Low-frequency variation
     alone on a smooth circle reads as a *wavy* edge — an airbrushed blob, not
     ink. The tear has to land at roughly 40 cycles round the circle to read as
     bristle tips rather than as blur. */
  const lobes = fbm1(mulberry32(seed ^ 0x1b873593), 2);
  const ragged = fbm1(mulberry32(seed ^ 0x27d4eb2f), 3);
  const tear1 = fbm1(mulberry32(seed ^ 0x9b05688c), 2);
  const fine = fbm1(mulberry32(seed ^ 0x165667b1), 2);
  const notch = fbm1(mulberry32(seed ^ 0x3b9aca07), 2);

  const [outLo, outHi] = STROKE.poolOut;
  const [inLo, inHi] = STROKE.poolIn;

  for (let i = 0; i < n; i++) {
    const p = path[i];
    let w = widths[i];

    /* How much this part of the mark is loaded, 0 = the bare circle, 1 = the
       middle of a blot. Everything below scales with it, and that is not a
       detail. The modulation was tuned when the circle was drawn at more than
       twice its present weight; applied flat to a mark that thin it can drive
       the half-width *negative*, and a negative half-width inverts the band and
       makes the circle disappear entirely — which is exactly what it did.
       Physically it is also the right shape: a fine pen line is smooth, and
       tearing is a property of heavy, wet ink. */
    const load = peak > 0 ? Math.min(1, w / peak) : 0;
    const tear = STROKE.ragged * (0.16 + 0.84 * load);

    w *= 1 + tear * ((lobes(p.u * 3.1) - 0.45) * 1.5
                   + (ragged(p.u * 9) - 0.5) * 1.0
                   + 1.05 * (tear1(p.u * 40) - 0.5) * 2
                   + 0.30 * (fine(p.u * 96) - 0.5) * 2);

    /* Sparse deep notches, on the blots only. The reference blots are bitten
       into by white wedges a third of the way through, and a width that only
       *wobbles* never produces one — the modulation has to reach zero locally.
       22 cycles round the circle puts two or three notches across a blot. */
    w *= 1 - 0.30 * load * smoothstep(0.70, 0.95, notch(p.u * 22));

    if (w < 0) w = 0;

    const o = outLo + (outHi - outLo) * load;
    const k = inLo + (inHi - inLo) * load;
    outer[i] = [p.x + p.nx * w * o, p.y + p.ny * w * o];
    inner[i] = [p.x - p.nx * w * k, p.y - p.ny * w * k];
  }
  return { outer, inner };
}

/**
 * Draw a run of the band as longitudinal strips rather than one solid polygon.
 *
 * This is the difference between ink and a vector shape. A filled polygon is
 * uniformly opaque over its whole footprint and the eye reads that instantly as
 * machine-made. Real ink over its own path is striated: the brush has bristles,
 * some touch the glass and some do not, so the mark is lengthwise streaks with
 * thin gaps through it. The references are full of these — most visibly in the
 * blots, which are torn into ribbons rather than being solid blobs.
 *
 * Each strip is a quad between two fractions of the way from the inner edge to
 * the outer edge, so the strips follow the band as it turns, and their alpha
 * comes from a noise that varies slowly along the arc and independently across
 * the width — which is what makes the gaps run *along* the stroke rather than
 * across it. Runs share sample points with their neighbours, so no seams.
 *
 * The number of strips follows the local width, and that is not a detail. A
 * fixed eight across a thin circle makes each strip sub-pixel, and sub-pixel quads
 * antialias into a pale grey line — the whole quiet half of the ring came out
 * washed out for exactly this reason. One strip where the stroke is thin (so it
 * is solid), eight where it is heavy (so it is torn).
 *
 * @param {object} o
 * @param {number} o.maxStrips  most streaks to break a heavy band into
 * @param {number} o.along      arc parameter of this run, 0..1
 * @param {number} o.load       local half-width over the stroke's peak, 0..1
 * @param {function(number,number,number):number} o.alphaAt  (across, along, load)
 */
export function drawBandChunk(ctx, band, from, to, o) {
  const strips = Math.max(1, Math.min(o.maxStrips,
    Math.round(1 + o.load * 9)));
  for (let j = 0; j < strips; j++) {
    const t0 = j / strips, t1 = (j + 1) / strips;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const o2 = band.outer[i], n2 = band.inner[i];
      const x = n2[0] + (o2[0] - n2[0]) * t1;
      const y = n2[1] + (o2[1] - n2[1]) * t1;
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = to; i >= from; i--) {
      const o2 = band.outer[i], n2 = band.inner[i];
      ctx.lineTo(n2[0] + (o2[0] - n2[0]) * t0, n2[1] + (o2[1] - n2[1]) * t0);
    }
    ctx.closePath();
    const a = o.alphaAt((t0 + t1) * 0.5, o.along, o.load);
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
    ctx.fill();
  }
}

/**
 * The striation pattern: how much ink a given streak carries.
 *
 * The shape of this curve matters more than the noise. Remapping a mean-0.5
 * noise linearly onto 0..1 gives a mean alpha near 0.4, which turns the whole
 * ring grey — it looks like a faded photocopy of a logogram rather than like
 * ink. What is wanted is a mark that is *nearly solid* and *interrupted*, so the
 * curve is an offset blend that stays high, plus a separate cutoff for the few
 * places the tip skipped the glass entirely.
 *
 * How far the bristles separate depends on pressure: the circle is nearly
 * unbroken, a blot is torn into ribbons.
 */
export function striations(seed) {
  const across = fbm1(mulberry32(seed ^ 0x7feb352d), 3);
  const along = fbm1(mulberry32(seed ^ 0x846ca68b), 3);
  const [tearLo, tearHi] = STROKE.tear;
  return (t, u, load) => {
    const n = 0.60 * across(u * 3.6 + t * 4.3) + 0.40 * along(u * 11 + t * 9.5);
    const k = tearLo + (tearHi - tearLo) * clamp01(load);
    const a = (1 - k) + k * n;
    return clamp01(a) * smoothstep(0, STROKE.skip, n);
  };
}

/* ═══ dry brush ═════════════════════════════════════════════════════════ */

/**
 * Fine streaks along the stroke: the scratchy interior and torn edge.
 *
 * Offsets are in units of the *ring weight*, not of the local width. Scaled to
 * the local width the streaks look reasonable on the circle and completely wrong on
 * a blot, where each one becomes a long diagonal across the whole swell.
 */
export function dryTexture({ path, widths, seed, ringHalf }) {
  const n = path.length;
  const rng = mulberry32(seed ^ 0x51ed270b);
  const wob = fbm1(mulberry32(seed ^ 0x2c1b3a6d), 3);
  const marks = [];
  const count = Math.round(n * 1.3);

  for (let i = 0; i < count; i++) {
    const idx = Math.min(n - 1, Math.floor(rng() * n));
    const local = widths[idx];
    const len = ri(rng, 2, 9);
    if (idx + len >= n) continue;

    const off = (0.3 + 1.2 * rng()) * ringHalf * (rng() < 0.5 ? 1 : -1);
    const steps = [];
    for (let k = 0; k < len; k++) {
      const j = idx + k;
      const q = path[j];
      const o = Math.min(widths[j] * 0.45, off + ringHalf * (wob((j / n) * 9 + i) - 0.5) * 1.6);
      steps.push([q.x + q.nx * o, q.y + q.ny * o]);
    }
    if (steps.length < 2) continue;

    const fat = local > ringHalf * 2.4;
    marks.push({
      steps,
      w: ringHalf * (0.20 + 0.70 * rng()),
      a: (0.08 + 0.34 * rng()) * (fat ? 1 : 0.42),
    });
  }
  return marks;
}

export function drawDryTexture(ctx, marks) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of marks) {
    ctx.beginPath();
    ctx.moveTo(m.steps[0][0], m.steps[0][1]);
    for (let i = 1; i < m.steps.length; i++) ctx.lineTo(m.steps[i][0], m.steps[i][1]);
    ctx.lineWidth = m.w;
    ctx.strokeStyle = `rgba(0,0,0,${m.a.toFixed(4)})`;
    ctx.stroke();
  }
}

