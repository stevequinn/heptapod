/* ═══════════════════════════════════════════════════════════════════════════
   The stroke.

   A logogram is ONE continuous stroke whose *width* is the primary variable.
   Measured off the reference figures:

     hairline  0.043 R across (half-width 0.022) — the thin, quiet part
     mass      up to 0.44 R across (10x), over 24% of the circumference

   The mass is not an object beside the ring. It is the ring, fatter. An earlier
   version drew the ring at a constant hairline and then laid a filled band on
   top, which is why it read as a glump stuck to a wire — an architectural
   error, not a parametric one, and no amount of tuning the band fixed it.

   So everything here operates on a width profile around one path:

     ringProfile   the hairline, the twelve-sector ink profile, the masses, and
                   where the stroke lifts off the glass
     ringBand      the stroke itself, as a band whose edges follow that profile
     striations    how each lengthwise streak is inked — the dry-brush gaps
     dryTexture    fine streaks along the stroke, and a torn edge

   All geometry is in glyph-local space: the nominal ring sits at radius 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { STROKE } from '../config.js';
import { TAU, angDiff, clamp01, fbm1, mulberry32, ri, smoothstep } from '../lib/math.js';

/* ═══ the width profile ═════════════════════════════════════════════════ */

/**
 * Half-width for every sample around the ring.
 *
 * Three contributions, in ascending order of authority:
 *
 *   1. a hairline weighted by the twelve-sector ink profile, so the quiet parts
 *      of the stroke are still inked unevenly rather than uniformly
 *   2. whichever mass covers this angle, taking the maximum
 *   3. the lift-off, where the limb came off the glass and the swell goes
 *
 * Widths from a mass arrive here already in half-width units, so there is no
 * remapping step. That is deliberate — the remap existed only to translate a
 * cellular automaton's measurements, and it was where the units got conflated.
 *
 * @param {Array<{angle:number, halfSpan:number, widths:Float32Array}>} masses
 * @param {Float32Array} sectorProfile  per-sector ink weight, 0..1
 * @param {number} hairline             half-width with no ink, ring radii
 * @param {number} samples
 * @param {function(number):number} [flowAt]  0..1 where the stroke has lifted
 * @returns {{widths: Float32Array, peak: number, massHalfSpan: Float32Array}}
 */
export function ringProfile({ masses, sectorProfile, hairline, samples, flowAt }) {
  const M = sectorProfile.length;
  const widths = new Float32Array(samples);
  const floor = hairline * 0.6;

  let peak = hairline;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;

    // 1. the hairline, weighted by which sector of the logogram this is
    const u = (a / TAU) * M;
    const i0 = Math.floor(u) % M;
    const f = u - Math.floor(u);
    const sp = sectorProfile[i0]
             + (sectorProfile[(i0 + 1) % M] - sectorProfile[i0]) * f * f * (3 - 2 * f);
    let w = hairline * STROKE.base[0] + hairline * STROKE.base[1] * sp;

    // 2. the masses
    for (const d of masses) {
      const dd = angDiff(a, d.angle);
      if (Math.abs(dd) > d.halfSpan) continue;
      const t = (dd / d.halfSpan + 1) * 0.5;
      const k = Math.max(0, Math.min(d.widths.length - 1,
        Math.round(t * (d.widths.length - 1))));
      if (d.widths[k] > w) w = d.widths[k];
    }

    // 3. where the limb has lifted, the swell goes and only a trace is left.
    //    In the deepest part of a lift the contact goes entirely — the
    //    references have ~6% of the circle with no ink at all, and a stroke
    //    that merely thins never produces a true gap.
    if (flowAt) {
      const flow = flowAt(a);
      w = floor + (w - floor) * flow;
      if (flow < STROKE.lift) w *= smoothstep(STROKE.lift * 0.15, STROKE.lift, flow);
    }

    widths[i] = w;
    if (w > peak) peak = w;
  }

  return { widths, peak, floor };
}

/* ═══ the band ══════════════════════════════════════════════════════════ */

/**
 * The stroke as a band whose two edges follow the width profile.
 *
 * The inner edge sits closer in than the outer edge pushes out, and the
 * asymmetry grows with the local width. Ink displaced by a brush travelling
 * round a circle piles up outside the line it travelled, and it piles up more
 * the harder the brush was pressed — so a band with a *fixed* asymmetry reads
 * as a different stroke rather than as a heavier one.
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
     the masses big rounded scallops, which is what a loaded brush leaves;
     `ragged` and `tear` break the boundary up; `fine` is the sawtooth of
     individual bristle tips catching the glass.

     The frequencies matter as much as the amplitudes. Low-frequency variation
     alone on a smooth circle reads as a *wavy* edge — an airbrushed blob, not
     ink. The tear has to land at roughly 40 cycles round the circle to read as
     bristle tips rather than as blur. */
  const lobes = fbm1(mulberry32(seed ^ 0x1b873593), 2);
  const ragged = fbm1(mulberry32(seed ^ 0x27d4eb2f), 3);
  const tear = fbm1(mulberry32(seed ^ 0x9b05688c), 2);
  const fine = fbm1(mulberry32(seed ^ 0x165667b1), 2);
  const notch = fbm1(mulberry32(seed ^ 0x3b9aca07), 2);

  const [outLo, outHi] = STROKE.poolOut;
  const [inLo, inHi] = STROKE.poolIn;

  for (let i = 0; i < n; i++) {
    const p = path[i];
    let w = widths[i];

    w *= 1 + STROKE.ragged * ((lobes(p.u * 3.1) - 0.45) * 1.5
                            + (ragged(p.u * 9) - 0.5) * 1.0
                            + 1.05 * (tear(p.u * 40) - 0.5) * 2
                            + 0.30 * (fine(p.u * 96) - 0.5) * 2);

    /* Sparse deep notches. The reference masses are bitten into by white
       wedges a third of the way through, and a width that only *wobbles* never
       produces one — the modulation has to be able to reach zero locally. 26
       cycles round the circle puts two or three notches across a mass. */
    w *= 1 - 0.38 * smoothstep(0.70, 0.95, notch(p.u * 22));

    const load = peak > 0 ? Math.min(1, w / peak) : 0;
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
 * masses, which are torn into ribbons rather than being solid blobs.
 *
 * Each strip is a quad between two fractions of the way from the inner edge to
 * the outer edge, so the strips follow the band as it turns, and their alpha
 * comes from a noise that varies slowly along the arc and independently across
 * the width — which is what makes the gaps run *along* the stroke rather than
 * across it. Runs share sample points with their neighbours, so no seams.
 *
 * The number of strips follows the local width, and that is not a detail. A
 * fixed eight across a hairline makes each strip sub-pixel, and sub-pixel quads
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
 * How far the bristles separate depends on pressure: the hairline is nearly
 * unbroken, the mass is torn into ribbons.
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
 * Offsets are in units of the *hairline*, not of the local width. Scaled to the
 * local width the streaks look reasonable on a hairline and completely wrong on
 * a mass, where each one becomes a long diagonal across the whole swell.
 */
export function dryTexture({ path, widths, seed, hairline }) {
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

    const off = (0.3 + 1.2 * rng()) * hairline * (rng() < 0.5 ? 1 : -1);
    const steps = [];
    for (let k = 0; k < len; k++) {
      const j = idx + k;
      const q = path[j];
      const o = Math.min(widths[j] * 0.45, off + hairline * (wob((j / n) * 9 + i) - 0.5) * 1.6);
      steps.push([q.x + q.nx * o, q.y + q.ny * o]);
    }
    if (steps.length < 2) continue;

    const fat = local > hairline * 2.4;
    marks.push({
      steps,
      w: hairline * (0.20 + 0.70 * rng()),
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

