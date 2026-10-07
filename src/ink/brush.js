/* ═══════════════════════════════════════════════════════════════════════════
   The stroke.

   Measured against the 3300px originals in Wolfram's ScriptLogoJpegs rather
   than the low-resolution translation sheet, a logogram is ONE continuous
   stroke whose *width* is the primary variable:

     hairline   ~0.023 ring radii (half-width) — ~3.5px on a 75px radius
     blade peak ~0.147 ring radii — ~22px, so a swell of about 6.4x

   And the blade is not an object beside the ring. It is the ring, fatter. An
   earlier version drew the ring as a constant hairline and then laid a filled
   band on top of it, which is why it read as a glump stuck to a wire — that
   was an architectural error, not a parametric one.

   So everything here operates on a width profile around one path:

     ringProfile   the hairline, the sector ink profile, and the swell the
                   automaton measured
     ringBand      the stroke itself, as a filled band whose edges follow that
                   profile — this is what makes the blade taper to a point at
                   both ends
     dryTexture    the scratchy interior and ragged edge that a clean filled
                   band does not have, and which is the giveaway that a shape
                   is vector rather than painted
     offshoots     short wedges with width, tapering to points, fanning along
                   the direction of travel
     spatter       a few detached dots by the fat region, which the originals
                   do have — the low-res sheet hid this

   All geometry here is in glyph-local space: the nominal ring sits at radius 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { BRUSH, CA } from '../config.js';
import { TAU, angDiff, clamp01, fbm1, mulberry32, ri, rr, smoothstep } from '../lib/math.js';

/* ═══ the width profile ═════════════════════════════════════════════════ */

/**
 * Half-width for every sample along the stroke.
 *
 * Three contributions, in ascending order of authority:
 *
 *   1. a hairline modulated by the twelve-sector ink profile, so the quiet
 *      parts of the stroke are still weighted rather than uniform
 *   2. whichever deposit covers this angle, taking the maximum — this is the
 *      automaton's own measurement, and the only place a rule appears
 *   3. a gamma push, because a lacy automaton measures widths linearly but a
 *      brush does not: it either runs thin or loads up
 *
 * @param {Array<{angle:number, halfSpan:number, widths:Float32Array}>} deposits
 * @param {Float32Array} sectorProfile  per-sector ink weight, 0..1
 * @param {number} hairline             half-width with no ink, ring radii
 * @param {function} [flowAt]           0..1 where the stroke has lifted off the
 *   glass. It thins the swell rather than removing it, which is what the
 *   references do — a closed ring whose weight fades, not a broken circle.
 * @returns {{widths: Float32Array, peak: number}}
 */
export function ringProfile({ deposits, sectorProfile, hairline, samples, flowAt }) {
  const M = sectorProfile.length;
  const widths = new Float32Array(samples);
  const floor = hairline * 0.6;

  /* The two ends of the remap.
     `measuredMax` is how much measured ink counts as a full blade —
     BRUSH.bladeReach. Not CA.reach: the automaton's envelope has to reach past
     the stroke so the bristles have somewhere to go, so the envelope and the
     weight are deliberately different numbers.
     `targetMax` is the stroke's own peak, expressed as a multiple of the
     hairline because that is how the references behave — the ratio between the
     thin part and the blade is the glyph's most legible feature, and it is
     remarkably consistent from one frame to the next.

     These used to be conflated, and multiplying one into the other is how the
     blade ended up at 0.9 ring radii: nearly as thick as the ring is wide. */
  const measuredMax = Math.max(1e-6, BRUSH.bladeReach - floor);
  const targetMax = hairline * BRUSH.swellMax;

  let peak = floor;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * TAU;

    // 1. the hairline, weighted by which sector of the logogram this is
    const u = (a / TAU) * M;
    const i0 = Math.floor(u) % M;
    const f = u - Math.floor(u);
    const sp = sectorProfile[i0]
             + (sectorProfile[(i0 + 1) % M] - sectorProfile[i0]) * f * f * (3 - 2 * f);
    let w = hairline * (0.62 + 0.85 * sp);

    // 2. the automaton's measurement, wherever there is one
    for (const d of deposits) {
      const dd = angDiff(a, d.angle);
      if (Math.abs(dd) > d.halfSpan) continue;
      const t = (dd / d.halfSpan + 1) * 0.5;
      const k = Math.max(0, Math.min(d.widths.length - 1,
        Math.round(t * (d.widths.length - 1))));
      if (d.widths[k] > w) w = d.widths[k];
    }

    // 3. remap onto the stroke's own range. The exponent is what makes the
    //    blade broad: a linear map leaves the swell pinched around the single
    //    strongest measurement, and the references have fat runs, not spikes.
    const t = clamp01((w - floor) / measuredMax);
    let shaped = floor + (targetMax - floor) * Math.pow(t, 1 / BRUSH.swellGamma);

    // 4. where the limb has lifted, the swell goes and only a trace is left
    if (flowAt) shaped = floor + (shaped - floor) * flowAt(a);

    widths[i] = shaped;
    if (shaped > peak) peak = shaped;
  }

  return { widths, peak };
}

/* ═══ the band ══════════════════════════════════════════════════════════ */

/**
 * The stroke as a filled band whose two edges follow the width profile.
 *
 * The inner edge sits closer in than the outer edge pushes out. Ink displaced
 * by a brush going round a circle piles up outside the line it travelled, and
 * the asymmetry also leaves the offshoots somewhere outward to grow from.
 *
 * @param {Array<{x,y,nx,ny,u}>} path  ring samples in glyph-local space
 * @param {Float32Array} widths         per-sample half-width
 * @param {number} targetMax            the stroke's peak half-width, which sets
 *   how far the band bulges outward under load
 */
export function ringBand({ path, widths, seed, targetMax, taper = true }) {
  const n = path.length;
  const outer = new Array(n);
  const inner = new Array(n);
  /* Four scales of edge irregularity, and they do different jobs: `lobes` gives
     the fat regions big rounded scallops, which is what a loaded brush leaves;
     `ragged` and `tear` break the boundary up; `fine` is the sawtooth of
     individual bristle tips catching the glass.

     The frequencies matter as much as the amplitudes. Only low-frequency
     variation on a smooth circle reads as a *wavy* edge — an airbrushed blob —
     where the references are torn. The tear has to land at roughly 40 cycles
     round the circle to read as bristle tips rather than as blur. */
  const lobes = fbm1(mulberry32(seed ^ 0x1b873593), 2);
  const ragged = fbm1(mulberry32(seed ^ 0x27d4eb2f), 3);
  const tear = fbm1(mulberry32(seed ^ 0x9b05688c), 2);
  const fine = fbm1(mulberry32(seed ^ 0x165667b1), 2);

  for (let i = 0; i < n; i++) {
    const p = path[i];
    let w = widths[i];

    // both ends run out to a point, as a brush does when contact is lost
    if (taper) w *= Math.pow(Math.sin(Math.PI * p.u), 0.40);

    w *= 1 + BRUSH.ragged * ((lobes(p.u * 3.1) - 0.45) * 1.5
                           + (ragged(p.u * 9) - 0.5) * 1.0
                           + 0.75 * (tear(p.u * 40) - 0.5) * 2
                           + 0.30 * (fine(p.u * 96) - 0.5) * 2);

    /* Pooling. Ink displaced by a brush travelling round a circle piles up on
       the outside of its own line, and it piles up more the harder the brush
       was pressed — so the offset between the inner and outer edge grows with
       the local width. A band with a fixed asymmetry just looks like a
       different stroke, not like a heavier one. */
    const load = targetMax > 0 ? Math.min(1, w / targetMax) : 0;
    outer[i] = [p.x + p.nx * w * (0.62 + 0.58 * load), p.y + p.ny * w * (0.62 + 0.58 * load)];
    inner[i] = [p.x - p.nx * w * (0.44 - 0.18 * load), p.y - p.ny * w * (0.44 - 0.18 * load)];
  }
  return { outer, inner };
}

/**
 * Draw a run of the band as longitudinal strips rather than one solid polygon.
 *
 * This is the difference between ink and a vector shape. A filled polygon is
 * uniformly opaque along its whole footprint, and the eye reads that instantly
 * as machine-made. Real ink over its own path is striated: the brush has
 * bristles, some of them touch the glass and some do not, so the mark is a set
 * of lengthwise streaks with thin gaps running through it. The originals are
 * full of these — most visibly in the fat regions, where the mass is torn into
 * ribbons rather than being a solid blob.
 *
 * Each strip is a quad between two fractions of the way from the inner edge to
 * the outer edge, so the strips follow the band as it turns. Their alpha comes
 * from a noise that varies slowly along the arc and independently across the
 * width, which is what makes the gaps run *along* the stroke rather than across
 * it. Runs share sample points with their neighbours, so there are no seams.
 *
 * @param {object} o
 * @param {number} o.strips   how many lengthwise streaks to break the band into
 * @param {number} o.along    arc parameter of this run, 0..1
 * @param {number} o.load     local half-width over the stroke's peak, 0..1
 * @param {function(number,number,number):number} o.alphaAt  (across, along, load)
 */
export function drawBandChunk(ctx, band, from, to, o) {
  const strips = o.strips;
  const along = o.along;
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
    const a = o.alphaAt((t0 + t1) * 0.5, along, o.load);
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
 * ring grey — it looks exactly like a faded photocopy of a logogram rather
 * than like ink. What is wanted is a mark that is *nearly solid* and
 * *interrupted*, so the curve is an offset blend that stays high and then a
 * separate cutoff for the few places the tip skipped the glass entirely.
 *
 * How far the bristles separate depends on pressure: the hairline is nearly
 * unbroken, and the blade is torn into ribbons.
 *
 * @param {number} seed
 * @returns {function(number, number, number): number} (across, along, load)
 */
export function striations(seed) {
  const across = fbm1(mulberry32(seed ^ 0x7feb352d), 3);
  const along = fbm1(mulberry32(seed ^ 0x846ca68b), 3);
  const [tearLo, tearHi] = BRUSH.tear;
  return (t, u, load) => {
    const n = 0.60 * across(u * 3.6 + t * 4.3) + 0.40 * along(u * 11 + t * 9.5);
    const k = tearLo + (tearHi - tearLo) * clamp01(load);
    const a = (1 - k) + k * n;
    return clamp01(a) * smoothstep(0, BRUSH.skip, n);
  };
}

/* ═══ dry brush ═════════════════════════════════════════════════════════ */

/**
 * The scratchy interior and torn edge of a loaded brush.
 *
 * Ink over its own footprint streaks along the direction of travel and breaks
 * where the brush ran dry. These are streaks along the stroke: longer and
 * darker over the fat region, sparse and short over the hairline.
 */
export function dryTexture({ path, widths, seed, hairline }) {
  const n = path.length;
  const rng = mulberry32(seed ^ 0x51ed270b);
  const wob = fbm1(mulberry32(seed ^ 0x2c1b3a6d), 3);
  const marks = [];
  const count = Math.round(n * 0.9);

  for (let i = 0; i < count; i++) {
    const idx = Math.min(n - 1, Math.floor(rng() * n));
    const local = widths[idx];
    const len = ri(rng, 2, 9);
    if (idx + len >= n) continue;

    /* Offset in units of the hairline, not of the local width. Scaled to the
       local width it looks reasonable on a hairline and completely wrong on a
       blade, where every streak becomes a long diagonal across the whole swell
       — which is exactly what it did before. */
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
      a: (0.06 + 0.30 * rng()) * (fat ? 1 : 0.30),
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

/**
 * Bristles: the fine hairs a loaded brush leaves as it lifts off a wet mass.
 *
 * Drawn with the same tapering stroke as the offshoots, because they are the
 * same kind of object — a stroke that dies to a point. The difference is only
 * in weight and direction: these are hairs in a rough starburst, the offshoots
 * are heavier wedges in a directional fan.
 */
export function drawBristles(ctx, hairs, widthMul, alpha) {
  for (const h of hairs) drawTaper(ctx, h, widthMul, alpha);
}

/* ═══ the things attached to the stroke ═════════════════════════════════ */

/**
 * Offshoots: short wedges that flick off the fat part of the stroke.
 *
 * Each tapers from a base that is a real fraction of the *local* stroke weight
 * down to a sharp point, so a spur off a blade is a heavy stroke and one off a
 * hairline is a whisker. Few, and biased along the tangent — the direction of
 * travel. A radial isotropic spray is the grammar of spatter; none of the
 * reference glyphs look like that.
 */
export function offshoots({ angle, halfSpan, widths, rng, strength = 1, count, targetMax }) {
  const out = [];
  const n = count ?? ri(rng, BRUSH.offshoots[0], BRUSH.offshoots[1]);
  const tangent = angle + Math.PI / 2;
  let peak = 0;
  for (const v of widths) if (v > peak) peak = v;
  if (peak <= targetMax * 0.28) return out;     // nothing loaded here to flick off

  for (let i = 0; i < n; i++) {
    const t = 0.26 + 0.48 * rng();
    const a = angle - halfSpan * 0.8 + t * halfSpan * 1.6;
    const k = Math.max(0, Math.min(widths.length - 1, Math.round(t * (widths.length - 1))));
    const local = widths[k];

    // start inside the ink, so it grows out of the stroke rather than onto it
    const r0 = 1 + local * 0.22;
    const x0 = Math.cos(a) * r0, y0 = Math.sin(a) * r0;

    const dir = tangent + (rng() - 0.42) * 2 * BRUSH.offshootCone;
    const len = rr(rng, BRUSH.offshootLength[0], BRUSH.offshootLength[1])
              * (0.45 + 0.7 * strength)
              * (0.65 + 0.5 * (local / peak));

    out.push({
      x0, y0,
      x1: x0 + Math.cos(dir) * len,
      y1: y0 + Math.sin(dir) * len,
      w: Math.max(targetMax * 0.05, local * rr(rng, BRUSH.offshootWidth[0], BRUSH.offshootWidth[1])),
      a: rr(rng, 0.55, 0.95),
      bow: rr(rng, -0.22, 0.22),
    });
  }
  return out;
}

/**
 * A tapering stroke that dies to a point, and bows slightly because a perfectly
 * straight one looks drawn where ink curls.
 *
 * `taperAt` is where the taper happens, as a fraction of the length. An offshoot
 * swells at the root and thins all the way down, so it wants 1. A bristle is a
 * hair of roughly even width that thins only near the tip, so it wants about
 * 0.4 — tapering along its whole length turns each one into a pale leaf, which
 * is exactly what the first pass of bristles looked like.
 *
 * Constant-width strokes are the giveaway that a filament is a line rather than
 * a hair, and a flat triangle is the giveaway that a shape is a polygon.
 */
export function drawTaper(ctx, o, widthMul, alpha) {
  const taperAt = o.taperAt ?? 1;
  const dx = o.x1 - o.x0, dy = o.y1 - o.y0;
  const len = Math.hypot(dx, dy) || 1e-6;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const SEG = 8;
  const left = [], right = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const bow = Math.sin(Math.PI * u) * (o.bow ?? 0) * len;
    const x = o.x0 + dx * u + px * bow;
    const y = o.y0 + dy * u + py * bow;
    const t = u < 1 - taperAt ? 1 : (1 - u) / taperAt;
    const hw = o.w * widthMul * t;
    left.push([x - px * hw, y - py * hw]);
    right.push([x + px * hw, y + py * hw]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (let i = 1; i <= SEG; i++) ctx.lineTo(left[i][0], left[i][1]);
  for (let i = SEG; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, o.a * alpha).toFixed(4)})`;
  ctx.fill();
}

/**
 * Spatter: a few detached dots by the fat region.
 *
 * An earlier reading of the low-resolution sheet concluded the references had
 * no speckle at all. The 3300px originals show they do — small, and clustered
 * where the brush flicked.
 */
export function spatter({ angle, widths, rng, hairline, strength = 1, targetMax }) {
  const out = [];
  let peak = 0;
  for (const v of widths) if (v > peak) peak = v;
  if (peak <= targetMax * 0.35) return out;
  const n = ri(rng, 2, 7);
  for (let i = 0; i < n; i++) {
    const a = angle + rr(rng, -1.1, 1.1);
    const d = 1 + peak * rr(rng, 0.4, 2.8);
    out.push({
      x: Math.cos(a) * d, y: Math.sin(a) * d,
      r: Math.max(hairline * 0.25, peak * rr(rng, 0.02, 0.06)),
      a: rr(rng, 0.2, 0.6) * (0.4 + 0.6 * strength),
    });
  }
  return out;
}

export function drawSpatter(ctx, dots, alpha) {
  for (const d of dots) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fillStyle = `rgba(0,0,0,${(d.a * alpha).toFixed(4)})`;
    ctx.fill();
  }
}