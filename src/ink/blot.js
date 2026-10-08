/* ═══════════════════════════════════════════════════════════════════════════
   The dense cluster.

   What this module is *not*: a shape. The previous architecture modelled the
   heavy regions as one filled band whose width followed a smooth envelope,
   and no amount of edge noise rescued it — a single coherent mass reads as
   vector geometry at a glance, and in the review sheet it read as exactly
   that: a black arc pasted onto a circle.

   What it is instead: a placement field plus a deposition process. The
   envelope below decides *where* ink is likely to land and how much of it,
   and then a few hundred overlapping strokes, capsules, flakes and scratches
   are thrown at it. The dark region is the accumulation; its boundary is
   wherever the last strokes happened to end, which is ragged because stroke
   ends are ragged. Nothing is ever filled as a whole.

   Three layers, and they do different jobs:

     strokes    the body — pressure marks along and across the field
     deposits   short heavy capsules at the wet core, where ink pools
     flakes     tiny irregular specks of near-solid ink at the very core

   plus fringe strokes that chew the boundary, dry-brush sweeps that trail
   away along the ring, and thin scratches that cross the mass.

   The envelope is asymmetric by construction (independent sigma and exponent
   per flank) and lumpy at three scales, with occasional deep bites, so even
   the *placement* is patchy rather than a smooth hill.

   All geometry is in glyph-local space; the ring sits at radius 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { BLOT } from '../config.js';
import { TAU, angDiff, clamp, clamp01, fbm1, lerp, mulberry32, ri, rr, smoothstep } from '../lib/math.js';

const noise = (rng) => mulberry32((rng() * 4294967296) >>> 0);

/* ═══ the placement envelope ════════════════════════════════════════════ */

/**
 * One cluster's field.
 *
 * `envAt(t)` returns a half-width in ring radii for t in [-1, 1] across the
 * cluster's angular span. It is used for three things only: to sample where
 * strokes land, to size and gate them, and to report a composite width to the
 * probe. It is never drawn.
 *
 * @param {object} o
 * @param {number} o.angle     cluster centre, absolute angle
 * @param {number} o.halfSpan  angular half-span, radians
 * @param {number} o.ringHalf
 * @param {number} o.strength  0.3..1.5, how heavy this deposit is
 * @param {function} o.rng
 * @param {object} o.style
 * @param {number} [o.samples]
 */
export function clusterShape({ angle, halfSpan, ringHalf, strength, rng, style, samples = 64 }) {
  const rough = style.inkRoughness;
  const nA = fbm1(noise(rng), 3);
  const nB = fbm1(noise(rng), 3);
  const nC = fbm1(noise(rng), 2);
  const pA = rng() * 90, pB = rng() * 90, pC = rng() * 90;

  const mid = rr(rng, -0.26, 0.26);
  const sigL = rr(rng, BLOT.sigma[0], BLOT.sigma[1]);
  const sigR = rr(rng, BLOT.sigma[0], BLOT.sigma[1]);
  const pL = rr(rng, BLOT.sharp[0], BLOT.sharp[1]);
  const pR = rr(rng, BLOT.sharp[0], BLOT.sharp[1]);
  const shoulder = rr(rng, BLOT.shoulder[0], BLOT.shoulder[1]);

  const sN = Math.pow(clamp01(strength / 1.25), 0.8);
  const basePeak = ringHalf * lerp(BLOT.peak[0], BLOT.peak[1], sN) * rr(rng, 0.85, 1.18);

  const bites = [];
  const nBite = ri(rng, 0, BLOT.bites);
  for (let i = 0; i < nBite; i++) {
    bites.push({ at: rr(rng, -0.85, 0.85), w: rr(rng, 0.05, 0.17), d: rr(rng, 0.45, 0.92) * (0.6 + 0.4 * rough) });
  }

  const raw = (t) => {
    const q = t - mid;
    const s = q < 0 ? sigL : sigR;
    const p = q < 0 ? pL : pR;
    /* a blunt core plus a low shoulder: the core is where the ink is wet,
       the shoulder is the stained stretch either side. Without it every
       cluster is a pointed hill and the circle between clusters is bare. */
    const core = Math.exp(-Math.pow(Math.abs(q) / s, p));
    const spread = shoulder * Math.exp(-Math.pow(Math.abs(q) / (s * 1.8), 1.15));
    let n = 1
      + BLOT.lumpiness * rough * (nA((t + 1) * 1.15 + pA) - 0.5) * 2
      + BLOT.lumpiness * rough * 0.60 * (nB((t + 1) * 3.4 + pB) - 0.5) * 2
      + BLOT.lumpiness * rough * 0.32 * (nC((t + 1) * 8.0 + pC) - 0.5) * 2;
    n = clamp(n, 0.12, 1.95);
    /* fade the very ends so the cluster does not stop on a straight edge */
    const window = smoothstep(1.0, 0.78, Math.abs(t));
    let v = basePeak * (core + spread) * n * window;
    for (const b of bites) v *= 1 - b.d * Math.exp(-Math.pow((t - b.at) / b.w, 2));
    return Math.max(0, v);
  };

  const widths = new Float32Array(samples);
  let mx = 0;
  for (let k = 0; k < samples; k++) {
    const v = raw(-1 + (2 * k) / (samples - 1));
    widths[k] = v;
    if (v > mx) mx = v;
  }
  const scale = mx > BLOT.maxHalf ? BLOT.maxHalf / mx : 1;
  const maxWidth = mx * scale;
  const envAt = (t) => (t < -1.01 || t > 1.01 ? 0 : raw(t) * scale);
  for (let k = 0; k < samples; k++) widths[k] *= scale;

  return {
    angle, halfSpan, ringHalf, strength,
    peak: maxWidth, maxWidth, mid, envAt, widths, samples,
  };
}

/** the cluster's half-width at an arbitrary absolute angle, for probes */
export function clusterWidthAt(shape, a) {
  const t = angDiff(a, shape.angle) / shape.halfSpan;
  if (t < -1 || t > 1) return 0;
  return shape.envAt(t);
}

/* ═══ mark generation ═══════════════════════════════════════════════════ */

/**
 * Build every mark one cluster is made of.
 *
 * Nothing random happens in draw(); everything is precomputed here so a
 * glyph is fully determined by its seed and style, and redrawing at a new
 * scale changes nothing but the scale.
 *
 * @param {object} o
 * @param {object} o.shape  from clusterShape()
 * @param {function} o.rng
 * @param {function(number):{x,y,nx,ny}} o.pathAt  ring path sampler
 * @param {object} o.style
 * @returns {{strokes:Array, deposits:Array, flakes:Array, fringe:Array,
 *            sweeps:Array, scratches:Array, anchors:Array}}
 */
export function clusterMarks({ shape, rng, pathAt, style }) {
  const { angle, halfSpan, peak, envAt, mid } = shape;
  const dens = style.clusterDensity;
  const rough = style.inkRoughness;
  const sN = clamp01(shape.strength / 1.25);

  const strokes = [];
  const deposits = [];
  const flakes = [];
  const fringe = [];
  const sweeps = [];
  const scratches = [];
  const anchors = [];

  /* paper holes: a few small ellipses the deposits avoid, so white shows
     through the accumulation. This is how holes are made — by leaving them,
     never by erasing. */
  const holes = [];
  const nHole = ri(rng, 0, BLOT.holes);
  for (let i = 0; i < nHole; i++) {
    holes.push({
      t: rr(rng, -0.72, 0.72), q: rr(rng, -0.50, 0.50),
      rt: rr(rng, 0.15, 0.40), rq: rr(rng, 0.20, 0.50),
    });
  }
  const inHole = (t, q) => holes.some((h) =>
    ((t - h.t) / h.rt) ** 2 + ((q - h.q) / h.rq) ** 2 < 1);

  /* envelope-weighted sampling of t */
  const NS = shape.widths.length;
  const cdf = new Float32Array(NS);
  let acc = 0;
  for (let k = 0; k < NS; k++) { acc += shape.widths[k] + peak * 0.02; cdf[k] = acc; }
  const sampleT = () => {
    const x = rng() * acc;
    let lo = 0, hi = NS - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m] < x) lo = m + 1; else hi = m;
    }
    const k = Math.min(NS - 1, lo);
    const prev = k > 0 ? cdf[k - 1] : 0;
    const f = (x - prev) / Math.max(1e-9, cdf[k] - prev);
    return -1 + (2 * (k + f)) / (NS - 1);
  };

  /* a shared low-frequency drift, so strokes bunch into patches rather than
     spreading like an even wash */
  const driftN = fbm1(noise(rng), 2);
  const driftP = rng() * 90;

  /** build a slightly bowed polyline stroke from a centre, angle and length */
  const strokePath = (cx, cy, dir, L, bow, wig) => {
    const dx = Math.cos(dir), dy = Math.sin(dir);
    const px = -dy, py = dx;
    const steps = 4;
    const ph = rng() * 90;
    const pts = [];
    for (let s = 0; s <= steps; s++) {
      const u = s / steps - 0.5;
      const t2 = s / steps;
      const lat = (bow * Math.sin(Math.PI * t2) + wig * (driftN(t2 * 2.7 + ph) - 0.5)) * L;
      pts.push([cx + dx * L * u + px * lat, cy + dy * L * u + py * lat]);
    }
    return pts;
  };

  /** a stroke that follows the ring's curvature, broken where it crosses a
   *  paper hole — so the holes in a mass are genuinely bare, not merely
   *  under-painted */
  const arcRuns = (t0, t1, q, bow, ph) => {
    const steps = 8;
    const runs = [];
    let cur = null;
    for (let k = 0; k <= steps; k++) {
      const u = k / steps;
      const t = t0 + (t1 - t0) * u;
      const a = angle + t * halfSpan;
      const P = pathAt(a);
      const e = envAt(t);
      const off = q * e + bow * peak * Math.sin(Math.PI * u)
                + (driftN(t * 2.3 + ph) - 0.5) * peak * 0.14;
      const qLoc = e > peak * 0.05 ? off / e : q;
      if (inHole(t, clamp(qLoc, -1.5, 1.5))) {
        if (cur && cur.length >= 2) runs.push(cur);
        cur = null;
        continue;
      }
      const pt = [P.x + P.nx * off, P.y + P.ny * off];
      if (!cur) cur = [pt]; else cur.push(pt);
    }
    if (cur && cur.length >= 2) runs.push(cur);
    return runs;
  };

  /* ── pressure strokes: the body of the mass ───────────────────────────── */
  const nStroke = Math.round(lerp(BLOT.strokes[0], BLOT.strokes[1], sN) * dens * rr(rng, 0.8, 1.2));
  for (let i = 0; i < nStroke; i++) {
    /* placement: the envelope sets the odds, with a small flat share so the
       body is not knotted at its peak */
    const t = rng() < 0.80 ? sampleT() : rr(rng, -0.6, 0.6);
    const e = envAt(t);
    if (e <= 0) continue;
    const q = (rng() + rng() + rng() - 1.5) / 1.5 * rr(rng, 0.75, 1.05)
            + 0.30 * rough * (driftN(t * 1.4 + driftP) - 0.5);
    if (inHole(t, q) && rng() < 0.85) continue;

    const a = angle + t * halfSpan;
    const P = pathAt(a);
    const cx = P.x + P.nx * q * e;
    const cy = P.y + P.ny * q * e;
    const tang = Math.atan2(P.ny, P.nx) + Math.PI / 2;

    /* a fifth of the body is long tracks that follow the ring — thin,
       low-alpha strokes that give the deposit its lengthwise striation,
       where the rounder dabs give it mass */
    if (rng() < 0.22) {
      const dirSign = rng() < 0.5 ? -1 : 1;
      const t0 = clamp(t - dirSign * rr(rng, 0.2, 0.6), -0.85, 0.85);
      const t1 = clamp(t + dirSign * rr(rng, 0.2, 0.6), -0.85, 0.85);
      const q2 = clamp(q * 0.5 + (rng() + rng() - 1) * 0.3, -0.85, 0.85);
      const w = shape.ringHalf * rr(rng, 0.35, 1.0);
      /* bimodal opacity: a mass built from uniform mid-grey marks looks
         airbrushed, so strokes are either faint underlay or firm ink */
      const alpha = clamp01((rng() < 0.5 ? rr(rng, 0.10, 0.26) : rr(rng, 0.36, 0.66))
                          * (0.7 + 0.4 * (e / peak)));
      for (const run of arcRuns(Math.min(t0, t1), Math.max(t0, t1), q2, rr(rng, -0.16, 0.16), rng() * 90)) {
        strokes.push({ pts: run, w, a: alpha * (0.45 + 0.55 * (run.length / 9)) });
      }
      continue;
    }

    const radial = rng() < 0.05;
    const dir = radial
      ? tang + (rng() < 0.5 ? -1 : 1) * (Math.PI / 2) + rr(rng, -0.35, 0.35)
      : tang + rr(rng, -0.35, 0.35) * (0.5 + 0.7 * rough);

    let L = peak * (0.30 + 1.8 * Math.pow(rng(), 1.5));
    if (rng() < 0.06) L *= rr(rng, 1.4, 2.0);
    L = Math.min(L, peak * 2.0);

    /* do not paint across a paper hole */
    const theta = dir - tang;
    const dt = (L * 0.5 * Math.abs(Math.cos(theta))) / Math.max(1e-6, halfSpan);
    const dq = (L * 0.5 * Math.abs(Math.sin(theta))) / Math.max(peak * 0.15, e);
    if ((inHole(t + dt, q + dq) || inHole(t - dt, q - dq)) && rng() < 0.6) continue;

    let w = shape.ringHalf * (0.35 + 2.2 * Math.pow(rng(), 1.7));
    w *= 0.55 + 0.70 * (e / peak);
    if (rng() < 0.12) w *= rr(rng, 1.5, 2.2);
    w = Math.min(w, peak * 0.38);

    const alpha = clamp01(
      (rng() < 0.45 ? rr(rng, 0.10, 0.26) : rr(rng, 0.38, 0.70))
      * (0.62 + 0.55 * (e / peak))
      * (0.80 + 0.50 * clamp01(w / (shape.ringHalf * 2)))
      * rr(rng, 0.8, 1.2),
    );

    const bow = rr(rng, -0.16, 0.16) * rough;
    const pts = strokePath(cx, cy, dir, L, bow, 0.10 * rough);
    strokes.push({ pts, w, a: alpha });

    /* the tip of the stroke is a candidate root for a bristle: filaments
       should grow out of the ink that is already there */
    const tip = pts[pts.length - 1];
    anchors.push({ x: tip[0], y: tip[1], dir, e, a, q, w });
  }

  /* ── deposits: short heavy capsules at the wet core ───────────────────── */
  const nDep = Math.round(lerp(BLOT.deposits[0], BLOT.deposits[1], sN) * dens * rr(rng, 0.8, 1.25));
  for (let i = 0; i < nDep; i++) {
    const t = clamp(mid + (rng() + rng() - 1) * 0.55, -1, 1);
    const e = envAt(t);
    if (e < peak * 0.30) continue;
    const q = (rng() + rng() - 1) * 0.62;
    if (inHole(t, q) && rng() < 0.85) continue;

    const a = angle + t * halfSpan;
    const P = pathAt(a);
    const cx = P.x + P.nx * q * e;
    const cy = P.y + P.ny * q * e;
    const tang = Math.atan2(P.ny, P.nx) + Math.PI / 2;
    const dir = tang + rr(rng, -0.45, 0.45);
    const L = peak * rr(rng, 0.25, 1.10);
    const w = shape.ringHalf * rr(rng, 1.8, 5.4) * (0.60 + 0.60 * (e / peak));
    const alpha = clamp01(rr(rng, 0.65, 1.0) * (0.7 + 0.5 * (e / peak)));

    /* half the deposits follow the ring rather than lying across it, so the
       solid core is elongated and streaked instead of a row of round pads */
    if (rng() < 0.5) {
      const dirSign = rng() < 0.5 ? -1 : 1;
      const t0 = clamp(t - dirSign * rr(rng, 0.15, 0.45), -1, 1);
      const t1 = clamp(t + dirSign * rr(rng, 0.15, 0.45), -1, 1);
      for (const run of arcRuns(Math.min(t0, t1), Math.max(t0, t1), q, rr(rng, -0.12, 0.12), rng() * 90)) {
        deposits.push({ pts: run, w, a: alpha * (0.6 + 0.4 * (run.length / 9)) });
      }
      continue;
    }
    deposits.push({ pts: strokePath(cx, cy, dir, L, rr(rng, -0.2, 0.2), 0.05), w, a: alpha });
  }

  /* ── flakes: small irregular chips of near-solid ink ──────────────────── *
   * Most sit at the wet core; a share are thrown along the boundary, where
   * they are what breaks the mass's silhouette into crumbs. */
  const nFlake = Math.round(lerp(BLOT.flakes[0], BLOT.flakes[1], sN) * dens * rr(rng, 0.7, 1.3));
  for (let i = 0; i < nFlake; i++) {
    const edge = rng() < 0.42;
    const t = edge ? sampleT() : clamp(mid + (rng() + rng() - 1) * 0.45, -1, 1);
    const e = envAt(t);
    if (e < peak * (edge ? 0.12 : 0.45)) continue;
    const q = edge
      ? (rng() < 0.5 ? -1 : 1) * rr(rng, 0.70, 1.25)
      : (rng() + rng() - 1) * 0.5;
    if (inHole(t, q) && rng() < 0.8) continue;

    const a = angle + t * halfSpan;
    const P = pathAt(a);
    const cx = P.x + P.nx * q * e;
    const cy = P.y + P.ny * q * e;
    const rot = Math.atan2(P.ny, P.nx) + Math.PI / 2 + rr(rng, -0.5, 0.5);
    const size = peak * (edge ? rr(rng, 0.015, 0.05) : rr(rng, 0.03, 0.12));
    const kv = ri(rng, 4, 7);
    const verts = [];
    for (let v = 0; v < kv; v++) {
      const ph = (v / kv) * TAU + rr(rng, -0.2, 0.2);
      const r = size * (0.45 + rng() * 1.05);
      const x = Math.cos(ph) * r * 1.7, y = Math.sin(ph) * r;
      verts.push([cx + Math.cos(rot) * x - Math.sin(rot) * y,
        cy + Math.sin(rot) * x + Math.cos(rot) * y]);
    }
    flakes.push({
      verts,
      a: clamp01(edge ? rr(rng, 0.35, 0.80) : rr(rng, 0.70, 1.0)),
    });
  }

  /* ── fringe: strokes that chew up the boundary ────────────────────────── */
  const nFringe = Math.round(lerp(BLOT.fringe[0], BLOT.fringe[1], sN) * dens * rr(rng, 0.8, 1.3));
  for (let i = 0; i < nFringe; i++) {
    const t = sampleT();
    const e = envAt(t);
    if (e < peak * 0.15) continue;
    const side = rng() < 0.5 ? -1 : 1;
    const q = side * rr(rng, 0.65, 1.35);
    if (inHole(t, q / 1.2) && rng() < 0.7) continue;

    const a = angle + t * halfSpan;
    const P = pathAt(a);
    const cx = P.x + P.nx * q * e;
    const cy = P.y + P.ny * q * e;
    const tang = Math.atan2(P.ny, P.nx) + Math.PI / 2;
    const dir = tang + side * rr(rng, -0.5, 0.6) + rr(rng, -0.2, 0.2);
    const L = peak * rr(rng, 0.25, 1.35);
    const w = shape.ringHalf * rr(rng, 0.16, 0.55);
    const alpha = clamp01(rr(rng, 0.12, 0.38) * (0.8 + 0.4 * rough));
    fringe.push({ pts: strokePath(cx, cy, dir, L, rr(rng, -0.25, 0.25), 0.12), w, a: alpha });
  }

  /* ── sweeps: dry-brush tails dragged along the ring ───────────────────── *
   * A sweep is not a line: it is a bundle of strands that leaves the mass
   * together, spreads a little, and thins to nothing at its dry end. Each
   * strand is drawn in two segments so its density can fall along its
   * length — a constant-alpha stroke reads as a wire. */
  const nSweep = ri(rng, BLOT.sweeps[0], BLOT.sweeps[1]);
  for (let i = 0; i < nSweep; i++) {
    const t0 = rr(rng, -0.85, 0.85);
    const dirSign = rng() < 0.5 ? -1 : 1;
    const side = rng() < 0.55 ? 1 : -1;
    const span = rr(rng, 0.30, 1.10);
    const strands = ri(rng, 3, 6);
    const baseW = shape.ringHalf * rr(rng, 1.6, 3.6);
    const q0 = side * rr(rng, 0.30, 1.20);
    const spread = rr(rng, 1.5, 4.0);
    const wob = fbm1(noise(rng), 2);
    const ph = rng() * 90;
    for (let s = 0; s < strands; s++) {
      const f = strands === 1 ? 0 : s / (strands - 1) - 0.5;
      const w0 = (baseW / Math.max(1, strands * 0.7)) * rr(rng, 0.55, 1.0);
      for (const seg of [[0, 0.40, 0.50], [0.30, 0.70, 0.30], [0.60, 1, 0.13]]) {
        const steps = 5;
        const pts = [];
        for (let k = 0; k <= steps; k++) {
          const u = seg[0] + (seg[1] - seg[0]) * (k / steps);
          const aa = angle + t0 * halfSpan + dirSign * u * span;
          const P = pathAt(aa);
          const tt = t0 + (dirSign * u * span) / halfSpan;
          const env = envAt(clamp(tt, -1, 1));
          const off = q0 * env
                    + f * spread * shape.ringHalf * (1 - u * 0.6)
                    + (wob(u * 3.4 + ph + s) - 0.5) * shape.ringHalf * 1.7;
          pts.push([P.x + P.nx * off, P.y + P.ny * off]);
        }
        sweeps.push({
          pts,
          w: w0 * (1 - 0.45 * seg[0]),
          a: clamp01(seg[2] * rr(rng, 0.7, 1.15)),
        });
      }
    }
  }

  /* ── scratches: thin marks crossing the mass at an angle ──────────────── */
  const nScratch = ri(rng, BLOT.scratches[0], BLOT.scratches[1]);
  for (let i = 0; i < nScratch; i++) {
    const t = sampleT();
    const e = envAt(t);
    if (e <= 0) continue;
    const q = (rng() + rng() - 1) * 0.9;
    const a = angle + t * halfSpan;
    const P = pathAt(a);
    const cx = P.x + P.nx * q * e;
    const cy = P.y + P.ny * q * e;
    const tang = Math.atan2(P.ny, P.nx) + Math.PI / 2;
    const dir = tang + (rng() < 0.5 ? -1 : 1) * rr(rng, 0.6, 1.4);
    const L = peak * rr(rng, 0.5, 1.3);
    const w = shape.ringHalf * rr(rng, 0.10, 0.35);
    const alpha = clamp01(rr(rng, 0.06, 0.18));
    scratches.push({ pts: strokePath(cx, cy, dir, L, rr(rng, -0.1, 0.1), 0.06), w, a: alpha });
  }

  return { strokes, deposits, flakes, fringe, sweeps, scratches, anchors };
}

/* ═══ drawing ═══════════════════════════════════════════════════════════ */

/** draw a list of polyline strokes, each one its own path.
 *
 *  Mark widths are half-widths, in the same units as the ring's — so they
 *  double here. Getting this wrong once made every deposit half the weight it
 *  was measured to be, which is exactly what the early stroke versions looked
 *  like: scratchy pencil outlines around empty space. */
export function drawStrokes(ctx, list) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of list) {
    if (m.pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(m.pts[0][0], m.pts[0][1]);
    for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i][0], m.pts[i][1]);
    ctx.lineWidth = Math.max(m.w * 2, 1e-4);
    ctx.strokeStyle = `rgba(0,0,0,${m.a.toFixed(4)})`;
    ctx.stroke();
  }
}

/** draw small irregular flake polygons */
export function drawFlakes(ctx, list) {
  for (const m of list) {
    if (m.verts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(m.verts[0][0], m.verts[0][1]);
    for (let i = 1; i < m.verts.length; i++) ctx.lineTo(m.verts[i][0], m.verts[i][1]);
    ctx.closePath();
    ctx.fillStyle = `rgba(0,0,0,${m.a.toFixed(4)})`;
    ctx.fill();
  }
}
