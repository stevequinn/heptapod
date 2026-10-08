/* ═══════════════════════════════════════════════════════════════════════════
   The offshoots.

   The bristles, spines and tendrils that leave a dense cluster, and the
   spatter thrown with them.

   The rule that matters, and that took a long time to get right: these leave
   the accumulated ink, never the thin circle, and most of them continue a
   stroke that is already on the glass. blot.js hands over the tip of every
   pressure stroke as a candidate root, so a filament starts inside the mass
   and emerges from it along the direction of the mark it grew out of. A
   filament rooted in open air is the "hairy circle" failure; a filament
   rooted on a stroke is a bristle.

   Everything else is measured, and the older measurements still hold: short
   (median reach ~0.09 R), cross-section comparable to the hairline, a wide
   direction spread rather than a radial comb, and tips that taper to a
   rounded point. What this version adds is *composition*: four differently
   distributed types — a dense fringe of fine hairs, medium filaments, a few
   near-straight spines, and a few long curling tendrils — each with its own
   direction mixture, so the fringe reads as a hairy edge rather than as
   grass.

     filaments      build the geometry, once
     specks         detached flecks, clustered on the deposits
     drawFilaments  chains of round-capped segments, the taper
     drawSpecks     the flecks themselves
   ═══════════════════════════════════════════════════════════════════════════ */

import { OFFSHOOT, SPATTER } from '../config.js';
import { TAU, clamp, clamp01, fbm1, lerp, mulberry32, ri, rr } from '../lib/math.js';

/** how many points along a filament; enough for the bow and the undulation */
const SEGMENTS = 14;

/** the four kinds of filament, wired to the config table */
const TYPE = {
  fringe: {
    range: OFFSHOOT.fringe, len: OFFSHOOT.length.fringe,
    wid: OFFSHOOT.width.fringe, mix: OFFSHOOT.mix.fringe,
    bow: OFFSHOOT.bow.fringe, curl: OFFSHOOT.curl.fringe, und: 0.45,
    bulb: 0.35,
  },
  medium: {
    range: OFFSHOOT.medium, len: OFFSHOOT.length.medium,
    wid: OFFSHOOT.width.medium, mix: OFFSHOOT.mix.medium,
    bow: OFFSHOOT.bow.medium, curl: OFFSHOOT.curl.medium, und: 0.40,
    bulb: 0.60,
  },
  spine: {
    range: OFFSHOOT.spines, len: OFFSHOOT.length.spine,
    wid: OFFSHOOT.width.spine, mix: OFFSHOOT.mix.spine,
    bow: OFFSHOOT.bow.spine, curl: OFFSHOOT.curl.spine, und: 0.25,
    bulb: 0.80,
  },
  tendril: {
    range: OFFSHOOT.tendrils, len: OFFSHOOT.length.tendril,
    wid: OFFSHOOT.width.tendril, mix: OFFSHOOT.mix.tendril,
    bow: OFFSHOOT.bow.tendril, curl: OFFSHOOT.curl.tendril, und: 0.35,
    bulb: 1.0,
  },
};

/* triangular in [-1, 1], used where a Gaussian-ish spread is wanted */
const tri = (rng) => rng() + rng() - 1;
const wrapPi = (a) => {
  let d = a % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/* ═══ filaments ═════════════════════════════════════════════════════════ */

/**
 * Build every filament on a glyph.
 *
 * @param {object} o
 * @param {Array<{shape:object, anchors:Array}>} o.clusters  from blot.js
 * @param {function} o.rng
 * @param {number} o.ringHalf
 * @param {number} o.seed
 * @param {function(number):{x,y,nx,ny}} o.pathAt
 * @param {object} o.style
 * @returns {Array<{pts:Array, ws:Array, reach:number}>}
 */
export function filaments({ clusters, rng, ringHalf, seed, style, pathAt }) {
  const out = [];
  const dens = style.filamentDensity;
  const variance = style.filamentLengthVariance;

  for (const { shape, anchors } of clusters) {
    const sN = clamp01(shape.strength / 1.25);
    const skew = OFFSHOOT.lengthSkew * (0.25 + 0.75 * variance);
    const warp = fbm1(mulberry32((seed + Math.round(shape.angle * 1e6)) >>> 0), 2);

    /* pick a root. Half the time it is a stroke tip, so the bristle continues
       a mark that is on the glass; the other half it is a fresh position
       sampled from the envelope, so the fringe spreads along the whole
       deposit rather than only where a stroke happened to end. */
    const pickRoot = () => {
      for (let attempt = 0; attempt < 12; attempt++) {
        if (anchors.length && rng() < 0.55) {
          const an = anchors[Math.floor(rng() * anchors.length)];
          if (an.e > shape.peak * OFFSHOOT.minLoad) return an;
          continue;
        }
        const t = rr(rng, -0.97, 0.97);
        const e = shape.envAt(t);
        if (e < shape.peak * OFFSHOOT.minLoad || rng() > e / shape.peak) continue;
        const a = shape.angle + t * shape.halfSpan;
        const q = tri(rng) * 0.6;
        const P = pathAt ? pathAt(a) : { x: Math.cos(a), y: Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) };
        return {
          x: P.x + P.nx * q * e, y: P.y + P.ny * q * e,
          a, q, e, dir: Math.atan2(P.y, P.x) + Math.PI / 2,
        };
      }
      return null;
    };

    const emit = (spec) => {
      const an = pickRoot();
      if (!an) return;
      const rx = an.x, ry = an.y;
      const phi0 = Math.atan2(ry, rx);
      /* push the root to the silhouette: bristles belong on the edge of the
         ink, not over its middle, or the fringe reads as fur and vanishes
         under the mass */
      const qRaw = clamp(an.q ?? 0, -0.95, 0.95);
      const qSign = qRaw !== 0 ? Math.sign(qRaw) : (rng() < 0.5 ? -1 : 1);
      const q0 = qSign * rr(rng, 0.45, 1.00);
      /* move the root out with the shifted q, so the root sits on the
         silhouette the visible-length maths assumes it sits on */
      const rad = Math.hypot(rx, ry) || 1;
      const rTarget = 1 + q0 * (an.e ?? 0);
      const sx = (rx / rad) * rTarget, sy = (ry / rad) * rTarget;

      /* direction: the type's mixture, blended toward the direction of the
         stroke the bristle grew from */
      const mix = spec.mix;
      const roll = rng();
      let delta;
      if (roll < mix[0]) delta = tri(rng) * 0.45;
      else if (roll < mix[0] + mix[1]) delta = (rng() < 0.5 ? -1 : 1) * rr(rng, 0.95, 1.5);
      else delta = Math.PI + tri(rng) * 0.5;
      if (rng() < OFFSHOOT.inherit) {
        delta = lerp(delta, wrapPi(an.dir - phi0), 0.65);
      }
      delta += tri(rng) * OFFSHOOT.clumpFan * 0.7;

      const straight = spec === TYPE.spine;
      let visible = spec.len[0] + (spec.len[1] - spec.len[0]) * Math.pow(rng(), skew);
      if (rng() < OFFSHOOT.outlier[0] * (0.5 + 0.7 * variance)) {
        visible *= rr(rng, OFFSHOOT.outlier[1], OFFSHOOT.outlier[2]);
      }
      /* hairs that turn back across the interior are shorter: a long line
         diving through the middle of the circle is the one placement that
         always reads as a spike rather than as a bristle */
      if (Math.abs(wrapPi(delta)) > 2.0) visible *= 0.68;
      const maxOut = OFFSHOOT.maxLength * (straight ? 0.8 : 1);

      /* what the mass swallows, added back so the visible length is `visible` */
      const outward = Math.cos(delta);
      const cover = outward >= 0
        ? an.e * Math.max(0, 1 - q0) * outward
        : an.e * Math.max(0, 1 + q0) * (-outward);
      const len = Math.min(visible + cover, maxOut + cover);

      /* a filament that never clears the mass is invisible, and one so short
         it cannot be seen as a mark is not a filament the probe should count:
         drop anything under about two hundredths of a radius */
      if (len - cover < 0.018) return;

      const w0 = ringHalf
        * rr(rng, spec.wid[0], spec.wid[1])
        * (0.75 + 0.5 * shape.strength);
      const bow = rr(rng, spec.bow[0], spec.bow[1]) * (rng() < 0.5 ? -1 : 1);
      const curl = rr(rng, spec.curl[0], spec.curl[1]) * (rng() < 0.5 ? -1 : 1);
      const ph = rng() * 90;

      const dx = Math.cos(phi0 + delta), dy = Math.sin(phi0 + delta);
      const px = -dy, py = dx;
      const pts = new Array(SEGMENTS);
      const ws = new Array(SEGMENTS);
      for (let s = 0; s < SEGMENTS; s++) {
        const t = s / (SEGMENTS - 1);
        /* the cross-section: slow taper along most of the length, a pinch,
           then a swollen head at the tip. The references' tendrils do not
           come to points — they end in a rounded knob, and the round cap on
           the last segment turns the head into exactly that. The pinch makes
           the knob read at any width; without it a rising end is invisible. */
        const taper = OFFSHOOT.tipCap + (1 - OFFSHOOT.tipCap)
                    * Math.pow(1 - t, OFFSHOOT.taper);
        const pinch = 1 - OFFSHOOT.neckDepth * spec.bulb
                    * Math.exp(-Math.pow((t - OFFSHOOT.neckAt) / OFFSHOOT.neckWidth, 2));
        const bulb = OFFSHOOT.tipBulb * spec.bulb
                   * Math.exp(-Math.pow((1 - t) / OFFSHOOT.bulbWidth, 2));
        const und = 1 + spec.und * OFFSHOOT.undulate
                  * (warp(t * OFFSHOOT.undPeriods + ph * 0.5) - 0.5) * 2;
        ws[s] = Math.max(1e-4, w0 * (taper * pinch + bulb) * und);

        /* bow, curl and a little high-frequency wander; a strong curl is a
           tendril hooking back toward the mass */
        const lat = (bow * Math.sin(Math.PI * t)
                   + curl * t * t
                   + 0.10 * (warp(t * 2.4 + ph) - 0.5)) * len;
        pts[s] = [sx + dx * len * t + px * lat, sy + dy * len * t + py * lat];
      }

      out.push({ pts, ws, reach: len * Math.max(0, outward) });
    };

    /* clumped fringe: several original points, each with its own direction,
       and the hairs bunched around them */
    const nClump = ri(rng, OFFSHOOT.clumps[0], OFFSHOOT.clumps[1]);
    for (let c = 0; c < nClump; c++) {
      const nF = Math.round(
        (TYPE.fringe.range[0] + (TYPE.fringe.range[1] - TYPE.fringe.range[0]) * sN)
        * dens / nClump * rr(rng, 0.6, 1.5),
      );
      for (let i = 0; i < nF; i++) emit(TYPE.fringe);
    }

    for (const key of ['medium', 'spine', 'tendril']) {
      const spec = TYPE[key];
      const n = Math.round(
        (spec.range[0] + (spec.range[1] - spec.range[0]) * sN)
        * dens * rr(rng, 0.7, 1.3),
      );
      for (let i = 0; i < n; i++) emit(spec);
    }
  }
  return out;
}

/**
 * Draw filaments as chains of round-capped segments.
 *
 * Per-segment lineWidth is the only way to get a tapering tube out of the 2D
 * canvas, and the round cap on the final segment is the rounded tip the
 * measurements call for. Alpha stays 1 — a translucent filament doubles
 * darker wherever its own caps overlap, and a thin black line already reads
 * as light because it covers less paper.
 */
export function drawFilaments(ctx, list) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  for (const f of list) {
    for (let i = 0; i < f.pts.length - 1; i++) {
      ctx.beginPath();
      ctx.moveTo(f.pts[i][0], f.pts[i][1]);
      ctx.lineTo(f.pts[i + 1][0], f.pts[i + 1][1]);
      ctx.lineWidth = Math.max((f.ws[i] + f.ws[i + 1]) * 0.5, 1e-4);
      ctx.stroke();
    }
  }
}

/* ═══ spatter ═══════════════════════════════════════════════════════════ */

/**
 * Detached flecks thrown where the ink flicked.
 *
 * Clustered on and near the deposits and thinning outward — never spread
 * evenly over the frame. A fraction are stretched teardrops, which is what a
 * dot thrown through air looks like; the rest are crumbs of ink.
 *
 * @returns {Array<{x,y,r,ry,rot,alpha}>}
 */
export function specks({ clusters, rng, style }) {
  const out = [];
  const splat = style.microSplatter;
  if (splat <= 0) return out;

  for (const { shape } of clusters) {
    const n = Math.round(ri(rng, SPATTER.perMass[0], SPATTER.perMass[1]) * splat);
    for (let i = 0; i < n; i++) {
      const a = shape.angle + rr(rng, -1.1, 1.1) * shape.halfSpan * 1.4;
      const d = 1 + Math.pow(rng(), 1.8) * SPATTER.reach[1] * (rng() < 0.5 ? 1 : -1);
      const r = rr(rng, SPATTER.size[0], SPATTER.size[1]) * (0.85 + 0.35 * shape.strength);
      const stretched = rng() < SPATTER.stretched;
      out.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        r,
        ry: stretched ? r * rr(rng, 1.6, 3.4) : r,
        rot: a + Math.PI / 2,
        alpha: clamp01(rr(rng, 0.35, 1)),
      });
    }
  }

  const stray = Math.round(ri(rng, SPATTER.stray[0], SPATTER.stray[1]) * splat);
  for (let i = 0; i < stray; i++) {
    const a = rr(rng, 0, TAU);
    const d = rr(rng, 0.6, 1.32);
    out.push({
      x: Math.cos(a) * d,
      y: Math.sin(a) * d,
      r: rr(rng, SPATTER.size[0], SPATTER.size[1]) * 0.8,
      ry: 0,
      rot: 0,
      alpha: clamp01(rr(rng, 0.2, 0.65)),
    });
  }
  return out;
}

export function drawSpecks(ctx, dots) {
  for (const d of dots) {
    ctx.beginPath();
    ctx.fillStyle = `rgba(0,0,0,${d.alpha.toFixed(4)})`;
    ctx.ellipse(d.x, d.y, d.r, d.ry || d.r, d.rot, 0, TAU);
    ctx.fill();
  }
}
