/* ═══════════════════════════════════════════════════════════════════════════
   Turning automaton growth into stroke weight.

   Two jobs:

   1. Run the automaton (automaton.js) inside a reach mask, because Wolfram's
      rules are self-sustaining and would otherwise flood the frame.

   2. Measure the result *perpendicular to the ring*, as a function of angle
      around it.

   Step 2 is the important one, and it is a change of what the automaton is
   for. The previous version traced every surviving cell into a hair pointing
   outward, which produced a radial spray — spatter on a wire. The originals in
   ScriptLogoJpegs say something different: the logogram is one continuous
   stroke whose *width* varies, and the fat part is the ring itself rather than
   anything attached to it.

   So the automaton no longer supplies geometry. It supplies a measurement: how
   deep is the ink at each angle around a deposit, which becomes the blade's
   half-width. A grid is a poor way to draw ink and a perfectly good way to
   measure it.

   Everything here is in glyph-local space, where the ring radius is 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { CA, BRUSH } from '../config.js';
import { grow } from './automaton.js';
import { pickRule } from './rules.js';
import { clamp01, fbm1, mulberry32, rr } from '../lib/math.js';

/** width-profile resolution per deposit */
export const PROFILE_SAMPLES = 56;

/* ═══ measurement ════════════════════════════════════════════════════════ */

/**
 * Measure how far the ink reaches perpendicular to the ring, as a function of
 * angle around `angle`.
 *
 * Geometry. For each ink cell:
 *
 *   u  its offset along the tangent, in ring radii
 *   v  its offset along the outward normal, in ring radii
 *
 * then the bucket index comes from `atan(u)`, which is the exact
 * arc-length-to-angle conversion at radius 1 — walking distance u along the
 * tangent from (cos a, sin a) lands exactly on the circle at angle
 * a + atan(u). Bucketing on u directly would make the blade very slightly
 * narrower than it is wide at the extremes, which is visible when the deposit
 * spans a third of the circle.
 *
 * Each bucket keeps the furthest outward ink and how many cells contributed.
 * The two are combined so that a bucket holding one stray filament does not
 * count as much as a bucket holding a packed mass — otherwise the profile is
 * just the reach mask's noise and the blade comes out lumpy.
 *
 * The reach mask already bounds v at CA.reach, so no normalisation is needed
 * and none is applied: a blot where the automaton barely grew gets a thin blade
 * on its own, which is the variation worth having.
 *
 * @param {Uint8Array} grid  P*P binary
 * @param {number} P         grid side
 * @param {object} o
 * @param {function(number,number): [number,number]} o.project  cell -> glyph xy
 * @param {number} o.angle     the deposit's angle on the ring
 * @param {number} o.halfSpan  angular half-width of the deposit
 * @param {number} o.strength  0..1, how heavy this deposit reads
 * @param {number} [o.samples]
 * @returns {Float32Array} half-width per sample across the deposit's arc
 */
export function measureProfile(grid, P, o) {
  const { project, angle, strength = 1 } = o;
  const halfSpan = o.halfSpan;
  const S = o.samples ?? PROFILE_SAMPLES;

  const ox = Math.cos(angle), oy = Math.sin(angle);
  const tx = -Math.sin(angle), ty = Math.cos(angle);

  const ext = new Float32Array(S);
  const mass = new Float32Array(S);

  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      if (!grid[y * P + x]) continue;
      const [px, py] = project(x, y);
      const dx = px - ox, dy = py - oy;
      const da = Math.atan(dx * tx + dy * ty);
      if (da < -halfSpan || da > halfSpan) continue;
      const v = dx * ox + dy * oy;              // outward along the normal
      const k = Math.min(S - 1, Math.max(0, Math.round((da / halfSpan + 1) * 0.5 * (S - 1))));
      if (v > ext[k]) ext[k] = v;
      mass[k]++;
    }
  }

  /* three passes of a [1,2,1] kernel over both: enough to turn a lacy
     automaton into a swell without moving the peak */
  const extS = blur1(ext, 2);
  const massS = blur1(mass, 2);
  let massMax = 0;
  for (let k = 0; k < S; k++) if (massS[k] > massMax) massMax = massS[k];

  const w = new Float32Array(S);
  const gain = 0.62 + 0.38 * clamp01(strength / 1.3);
  for (let k = 0; k < S; k++) {
    const t = k / (S - 1);
    // packed ink reads heavier than a lone filament at the same reach
    const massTerm = massMax > 0 ? 0.52 + 0.48 * (massS[k] / massMax) : 0;
    // and the deposit's ink has to die away before the arc's edge, or the blade
    // ends in a step
    const taper = Math.pow(Math.sin(Math.PI * t), 0.45);
    w[k] = extS[k] * massTerm * taper * gain;
  }
  return blur1(w, 1);
}

/** [1,2,1] smoothing, `passes` times, on a Float32Array */
function blur1(a, passes) {
  const n = a.length;
  let src = a;
  let dst = new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      dst[i] = (src[(i - 1 + n) % n] + 2 * src[i] + src[(i + 1) % n]) * 0.25;
    }
    if (p + 1 < passes) { const t = src; src = dst; dst = (t === a ? new Float32Array(n) : t); }
  }
  return dst;
}

/** the largest value in a profile */
function peakOf(widths) {
  let p = 0;
  for (let i = 0; i < widths.length; i++) if (widths[i] > p) p = widths[i];
  return p;
}

/* ═══ bristles ══════════════════════════════════════════════════════════ */

/**
 * Trace the growth into fine bristles.
 *
 * A second job for the same automaton run, and the one it is actually good at.
 * The traced cells used to *be* the logogram, which produced a radial spray on
 * a thin wire — spatter, not ink. Used as texture they are exactly right: the
 * originals show a wet mass with a rough starburst of fine hairs leaving it,
 * which is what a loaded brush does when it lifts, and which is precisely what
 * self-similar radial growth looks like.
 *
 * So the automaton's shape drives the stroke's width, and its texture drives
 * the bristles. Both from one run.
 *
 * Only cells on the outer side of the stroke emit, and only within the
 * deposit's own arc — a bristle is something the brush left behind as it came
 * off the mass, so it has to be adjacent to the mass.
 *
 * @returns {Array<{x0,y0,x1,y1,w,a}>}
 */
function traceBristles(grid, P, kx, ky, cell, angle, halfSpan, rng, o) {
  const at = (x, y) => (x < 0 || y < 0 || x >= P || y >= P ? 0 : grid[y * P + x]);
  const tx = -Math.sin(angle), ty = Math.cos(angle);
  const nx = Math.cos(angle), ny = Math.sin(angle);
  const out = [];

  for (let y = 0; y < P; y++) {
    const dy = (y - ky) * cell;
    for (let x = 0; x < P; x++) {
      if (!grid[y * P + x]) continue;

      const dx = (x - kx) * cell;
      const da = Math.abs(Math.atan(dx * tx + dy * ty));
      /* Falloff rather than a cutoff. A hard boundary at halfSpan puts a
         visible vertical cliff through the middle of every bristle tuft, which
         reads as a dandelion head rather than as a brush coming off a mass. */
      if (da > halfSpan || rng() > 1 - (da / halfSpan) ** 3) continue;
      const dv = dx * nx + dy * ny;
      /* Start just inside the band, not outside it. Ink under the band is
         hidden by it, which is the point: a bristle has to emerge from *within*
         the mass or it reads as a detached dandelion head hovering beside the
         stroke. */
      if (dv < o.from || dv > CA.reach) continue;

      let n = 0;
      for (let oy = -1; oy <= 1; oy++)
        for (let ox = -1; ox <= 1; ox++)
          if ((ox || oy) && at(x + ox, y + oy)) n++;
      const exposed = 8 - n;
      if (exposed < 2) continue;            // only the fringe of the growth

      const jx = (rng() - 0.5) * cell, jy = (rng() - 0.5) * cell;
      const px = Math.cos(angle) + dx + jx, py = Math.sin(angle) + dy + jy;

      /* Radially outward from the deposit, jittered widely. The reference
         starbursts are rough and near-omnidirectional, not combed along the
         tangent — an earlier version insisted on the tangent and produced a
         hedgehog instead of a wet brush lifting off. */
      const a = Math.atan2(dy + jy, dx + jx) + (rng() - 0.5) * o.spread;

      /* A few long outliers. Every reference has three or four bristles that
         reach far past the rest, well clear of the mass, and a distribution
         that is uniform over the lengths cannot produce them — the eye reads
         their absence as a combed wig rather than a brush. */
      const far = rng() < 0.10 ? rr(rng, 1.5, 2.6) : 1;
      const len = o.hairline * rr(rng, o.lenMin, o.lenMax) * far
                * (0.5 + 0.9 * (exposed / 8)) * (0.7 + 0.6 * rng());
      out.push({
        x0: px, y0: py,
        x1: px + Math.cos(a) * len, y1: py + Math.sin(a) * len,
        w: o.hairline * (0.16 + 0.30 * rng()) * (0.6 + 0.6 * exposed / 8),
        taperAt: 0.42,
        a: (0.62 + 0.38 * rng()) * (0.55 + 0.45 * exposed / 8),
        bow: (rng() - 0.5) * 0.7,
      });
      if (out.length >= o.countMax) return out;
    }
  }
  return out;
}

/* ═══ the automaton, one deposit at a time ═══════════════════════════════ */

/**
 * Grow one deposit and measure what it did.
 *
 * Geometry: the deposit sits at the centre of a patch of CA cells, and one
 * cell is `CA.cell` ring radii across. The patch is sized from those two
 * numbers rather than the other way round, so the growth resolution stays a
 * free parameter — at coarse cell sizes the automaton's own grid becomes
 * visible and the glyph reads as pixels.
 *
 * @param {object} o
 * @param {number} o.angle      where on the ring the deposit sits, radians
 * @param {number} o.spread     deposit seed radius, in ring radii
 * @param {number} o.halfSpan   angular half-width to measure over
 * @param {function} o.rng      seeded PRNG
 * @param {number} o.seed       glyph seed, so the mask noise is stable
 * @param {number} [o.strength] 0..1
 * @returns {{widths: Float32Array, peak: number, rule: number, cells: number}}
 */
export function growProfile({ angle, spread, halfSpan, rng, seed, strength = 1, samples, hairline = 0.024 }) {
  const P = CA.patch;
  const C = (P - 1) / 2;
  const cell = CA.cell;
  const reachCells = CA.reach / cell;

  const kx = C, ky = C;
  const seedR = Math.max(2, spread / cell);

  /* The patch has to hold the whole reach plus a margin, or the growth is
     clipped at a square boundary and the clipping looks like a fault in the
     brush. Raising `reach` without raising `patch` is an easy mistake. */
  const needed = 2 * (reachCells + CA.margin);
  if (P < needed) {
    throw new Error(
      `CA.patch ${P} is too small for CA.reach ${CA.reach} at CA.cell ${CA.cell}: ` +
      `needs at least ${Math.ceil(needed)}. Growth would be clipped square.`);
  }

  /* ---- 1. reach mask ---------------------------------------------------
     Two octaves: a low frequency giving the burst a lopsided overall shape, and
     a high one fraying where the filaments reach the limit. A clean circle is
     instantly readable as artificial and an ink boundary is never round.

     The displacement depends only on the angle, so it goes into a lookup and is
     indexed per pixel — evaluating five octaves of fbm per pixel over a quarter
     of a million samples costs more than the automaton run, to produce a value
     that is constant along each ray. */
  const lo = fbm1(mulberry32(seed * 2654435761 + 17), 3);
  const hi = fbm1(mulberry32(seed * 40503 + 991), 2);
  const LUTS = 512;
  const limLut = new Float32Array(LUTS);
  const wob = CA.wobble * (0.35 + 0.65 * strength);
  for (let i = 0; i < LUTS; i++) {
    const a = (i / LUTS) * Math.PI * 2;
    const r0 = lo(Math.cos(a) * 1.8 + 4.1) - 0.5;
    const r1 = hi(Math.cos(a) * 5.2 + 1.7) - 0.5;
    limLut[i] = reachCells * (1 + wob * (r0 * 1.5 + r1 * 0.7));
  }

  const keep = new Uint8Array(P * P);
  const k2 = LUTS / (Math.PI * 2);
  for (let y = 0; y < P; y++) {
    const dy = y - ky;
    const row = y * P;
    for (let x = 0; x < P; x++) {
      const dx = x - kx;
      let i = (Math.atan2(dy, dx) * k2) | 0;
      if (i < 0) i += LUTS;
      const l = limLut[i];
      keep[row + x] = dx * dx + dy * dy <= l * l ? 1 : 0;
    }
  }

  /* ---- 2. seed and run ------------------------------------------------- */
  const grid = new Uint8Array(P * P);
  const seedR2 = seedR * seedR;
  for (let y = 0; y < P; y++) {
    const dy = y - ky;
    for (let x = 0; x < P; x++) {
      const dx = x - kx;
      if (dx * dx + dy * dy < seedR2) grid[y * P + x] = 1;
    }
  }

  const rule = pickRule(rng);
  const out = grow(rule, grid, P, P, CA.steps, keep);

  /* ---- 3. measure ------------------------------------------------------ */
  const project = (x, y) => [Math.cos(angle) + (x - kx) * cell,
                            Math.sin(angle) + (y - ky) * cell];
  const widths = measureProfile(out, P, { project, angle, halfSpan, strength, samples });
  const bristles = traceBristles(out, P, kx, ky, cell, angle, halfSpan, rng, {
    from: hairline * BRUSH.swellMax * 0.55,
    lenMin: 1.8, lenMax: 8.0,
    spread: 2.2,
    hairline,
    countMax: BRUSH.bristles[1],
  });

  let cells = 0;
  for (let i = 0; i < out.length; i++) cells += out[i];

  return { widths, peak: peakOf(widths), bristles, rule, cells };
}

/**
 * The deposit without the automaton.
 *
 * A blade that swells where the sector profile says ink is heaviest, broken up
 * by two octaves of noise. Kept because it is what the automaton converges on
 * once it is smoothed into a width profile, and because it is the fallback
 * when automaton growth is switched off (`procedural` mode).
 */
export function proceduralProfile({ angle, halfSpan, rng, strength = 1, samples }) {
  const S = samples ?? PROFILE_SAMPLES;
  const w = new Float32Array(S);
  const lo = fbm1(mulberry32(rng() * 4294967296), 3);
  const hi = fbm1(mulberry32(rng() * 4294967296), 2);
  const p0 = rng() * 90, p1 = rng() * 90;
  const peak = CA.reach * (0.72 + 0.28 * strength);

  for (let k = 0; k < S; k++) {
    const t = k / (S - 1);
    // one broad swell, offset within the arc so the blade is not symmetric
    const c = 0.38 + 0.26 * rng();
    const d = (t - c) / 0.62;
    const body = Math.exp(-d * d * 1.6);
    const lump = 0.72 + 0.34 * lo(t * 2.1 + p0) + 0.16 * hi(t * 6.3 + p1);
    w[k] = peak * body * lump * (0.70 + 0.30 * strength);
  }
  return { widths: blur1(w, 1), peak: peakOf(w), rule: null, cells: 0 };
}

/** deterministic 0..1 from the rng, kept separate so proceduralProfile's
 *  signature does not need to thread an extra argument through */
function rng0(rng) { return rng(); }