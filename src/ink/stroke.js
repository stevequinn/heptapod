/* ═══════════════════════════════════════════════════════════════════════════
   The base stroke.

   A logogram is a hand-drawn circle of uneven weight, with deposits of ink
   accumulated on it. This module draws the circle. blot.js builds the
   deposits, offshoots.js the bristles that leave them.

   The circle is the constant in all 38 reference frames and the one thing
   that reads as *written* rather than as *drawn*: its width varies along the
   circumference, it wanders off true, and in a minority of frames the limb
   lifts and leaves a break. Earlier versions treated it as a mathematically
   even pen line; that reads as vector at a glance. What this file does not do
   is let the circle swell into the heavy regions — that mistake produced
   giant smooth filled arcs for most of this project's life. The heavy regions
   are built separately, from accumulated strokes.

     ringProfile  the circle's width, its swells, breaks and faint stretches
     ringBand     the mark itself, as a band whose edges follow that profile
     striations   how each lengthwise streak is inked — the dry-brush gaps
     ringTrails   scratch trails and dry ticks along the circle

   All geometry is in glyph-local space: the nominal ring sits at radius 1.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, STROKE } from '../config.js';
import { TAU, angDiff, clamp, clamp01, fbm1, lerp, mulberry32, ri, rr, smoothstep } from '../lib/math.js';

/* ═══ the width / ink profile ═══════════════════════════════════════════ */

/**
 * Half-width and ink coverage for every sample around the ring.
 *
 * Three structures, deliberately independent:
 *
 *   weight   the hairline, with slow noise, plus occasional local swells —
 *            pools of ink the brush picked up without depositing a cluster
 *   breaks   stretches where the limb lifted: ink drops to zero, with one
 *            clean end and one long fade, the way a lifted brush behaves
 *   faints   stretches where the tip barely touched: ink drops to a level
 *
 * @param {object} o
 * @param {function(number):number} o.profileAt  per-sector ink weight, 0..1
 * @param {number} o.ringHalf
 * @param {number} o.samples
 * @param {number} o.a0        angle of sample 0 (the ring starts at a random
 *   angle, and the profile must be sampled in absolute angle or every break
 *   lands in the wrong place)
 * @param {number} o.seed
 * @param {function} o.rng
 * @param {Array<{a:number,h:number}>} [o.avoid]  keep breaks away from these
 * @param {Array<{a:number,h:number,amp:number}>} [o.bumps]  gentle local
 *   thickenings of the ring itself — a loaded brush leaves a heavier line
 *   across the span where it deposits, so the ring runs thicker under a mass
 * @param {object} o.style     resolved STYLE
 * @returns {{widths:Float32Array, ink:Float32Array, breaks:Array, faints:Array}}
 */
export function ringProfile({
  profileAt, ringHalf, samples, a0, seed, rng, avoid = [], bumps = [], style,
}) {
  const widths = new Float32Array(samples);
  const ink = new Float32Array(samples).fill(1);

  const wob = fbm1(mulberry32((seed ^ 0x51ed270b) >>> 0), 4);
  const ph = rng() * 90;
  const wobAmp = 1 * (0.55 + 0.55 * style.ringWobble);

  const swells = [];
  const nSwell = ri(rng, STROKE.swell[0], STROKE.swell[1]);
  for (let i = 0; i < nSwell; i++) {
    swells.push({
      at: rr(rng, 0, TAU),
      amp: rr(rng, STROKE.swellAmp[0], STROKE.swellAmp[1]),
      span: rr(rng, STROKE.swellSpan[0], STROKE.swellSpan[1]),
    });
  }

  const blocked = (a, pad = 0.12) =>
    avoid.some((v) => Math.abs(angDiff(a, v.a)) < v.h + pad);

  const breaks = [];
  if (rng() < GLYPH.breakChance) {
    const want = ri(rng, 1, GLYPH.breaks[1]);
    for (let guard = 0; breaks.length < want && guard < 48; guard++) {
      const a = rr(rng, 0, TAU);
      if (blocked(a)) continue;
      if (breaks.some((b) => Math.abs(angDiff(a, b.a)) < 1.0)) continue;
      breaks.push({
        a,
        span: rr(rng, GLYPH.breakSpan[0], GLYPH.breakSpan[1]),
        lift: rr(rng, GLYPH.breakLift[0], GLYPH.breakLift[1]),
        side: rng() < 0.5 ? -1 : 1,
      });
    }
  }

  const faints = [];
  if (rng() < GLYPH.faintChance) {
    const want = ri(rng, 1, 2);
    for (let guard = 0; faints.length < want && guard < 40; guard++) {
      const a = rr(rng, 0, TAU);
      if (faints.some((f) => Math.abs(angDiff(a, f.a)) < 0.9)) continue;
      faints.push({
        a,
        span: rr(rng, GLYPH.faintSpan[0], GLYPH.faintSpan[1]),
        level: rr(rng, GLYPH.faintLevel[0], GLYPH.faintLevel[1]),
        ramp: rr(rng, 0.05, 0.14),
      });
    }
  }

  /* a fast noise for dashiness: a faint stretch is a dry pen, not a pale one,
     so it breaks into dashes rather than fading to a flat grey line */
  const dashN = fbm1(mulberry32((seed ^ 0x2545f491) >>> 0), 2);
  const dashPh = rng() * 90;

  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const a = a0 + u * TAU;
    const sp = profileAt(a);

    let f = 1 + wobAmp * (
      0.55 * (wob(u * 2.1 + ph) - 0.5) * 2
      + 0.22 * (wob(u * 5.7 + ph * 1.7) - 0.5) * 2
      + 0.08 * (wob(u * 13.3 + ph * 0.6) - 0.5) * 2
    );
    f *= 0.84 + 0.34 * sp;
    for (const sw of swells) {
      f *= 1 + sw.amp * Math.exp(-Math.pow(angDiff(a, sw.at) / sw.span, 2));
    }
    for (const bp of bumps) {
      f *= 1 + bp.amp * Math.exp(-Math.pow(angDiff(a, bp.a) / Math.max(0.06, bp.h * 0.9), 2));
    }
    widths[i] = clamp(ringHalf * f, ringHalf * 0.28, ringHalf * 2.6);

    let edge = 1;
    for (const b of breaks) {
      const d = angDiff(a, b.a);
      const ad = Math.abs(d);
      if (ad <= b.span * 0.5) { ink[i] = 0; edge = 0; continue; }
      const into = d * b.side;
      const fade = into > 0
        ? smoothstep(b.span * 0.5, b.span * 0.5 + b.lift, into)
        : smoothstep(b.span * 0.5, b.span * 0.5 + 0.035, ad);
      if (fade < ink[i]) ink[i] = fade;
      if (fade < edge) edge = fade;
    }
    for (const ft of faints) {
      const d = Math.abs(angDiff(a, ft.a));
      const t = 1 - smoothstep(ft.span * 0.5, ft.span * 0.5 + ft.ramp, d);
      const v = lerp(1, ft.level, t);
      if (v < ink[i]) ink[i] = v;
      if (v < edge) edge = v;
    }

    if (edge < 0.98) {
      /* taper the band into a break or a dry stretch, and dash it: a square
         end where the ink stops is the one thing that reads as a canvas bug */
      widths[i] *= 0.30 + 0.70 * edge;
      const dash = smoothstep(0.22, 0.58, dashN(u * 26 + dashPh));
      ink[i] *= 0.35 + 0.65 * dash;
      widths[i] *= 0.55 + 0.65 * dash;
    }
  }

  return { widths, ink, breaks, faints };
}

/* ═══ the band ══════════════════════════════════════════════════════════ */

/**
 * The stroke as a band whose two edges follow the width profile.
 *
 * The edge irregularity is multi-scale on purpose: low frequency alone gives
 * an airbrushed wobble, and the tear has to land at roughly 30-90 cycles
 * round the circle before it reads as bristle tips rather than as blur.
 * Scaled by STYLE.inkRoughness, so calibration can trade cleanliness for
 * damage.
 *
 * @param {object} o
 * @param {Array} o.path
 * @param {Float32Array} o.widths
 * @param {number} o.ringHalf
 * @param {number} o.seed
 * @param {object} o.style
 */
export function ringBand({ path, widths, ringHalf, seed, style }) {
  const n = path.length;
  const outer = new Array(n);
  const inner = new Array(n);

  const lobes = fbm1(mulberry32(seed ^ 0x1b873593), 2);
  const ragged = fbm1(mulberry32(seed ^ 0x27d4eb2f), 3);
  const tear1 = fbm1(mulberry32(seed ^ 0x9b05688c), 2);
  const fine = fbm1(mulberry32(seed ^ 0x165667b1), 2);
  const micro = fbm1(mulberry32(seed ^ 0x7feb352d), 2);

  const [outLo, outHi] = STROKE.poolOut;
  const [inLo, inHi] = STROKE.poolIn;
  const rough = STROKE.ragged * style.inkRoughness;

  for (let i = 0; i < n; i++) {
    const p = path[i];
    let w = widths[i];
    const load = clamp01((w / ringHalf - 0.9) / 1.5);

    w *= 1 + rough * (
      0.62 * (lobes(p.u * 3.1) - 0.5) * 2
      + 0.50 * (ragged(p.u * 8.7) - 0.5) * 2
      + 0.60 * (tear1(p.u * 31) - 0.5) * 2
      + 0.34 * (fine(p.u * 83) - 0.5) * 2
      + 0.30 * (micro(p.u * 150) - 0.5) * 2
    );
    if (w < widths[i] * 0.30) w = widths[i] * 0.30;

    const o = outLo + (outHi - outLo) * load;
    const k = inLo + (inHi - inLo) * load;
    outer[i] = [p.x + p.nx * w * o, p.y + p.ny * w * o];
    inner[i] = [p.x - p.nx * w * k, p.y - p.ny * w * k];
  }
  return { outer, inner };
}

/**
 * Draw a run of the band as lengthwise strips rather than one solid shape.
 *
 * Strips are quad ribbons between two fractions of the way from the inner to
 * the outer edge, so they follow the band as it turns, and their alpha comes
 * from noise that varies slowly along the arc and independently across the
 * width. The count follows the local width: a fixed number makes each strip
 * sub-pixel on the thin circle — which antialiases into a pale grey line —
 * while a heavy swell wants to be visibly torn.
 *
 * @param {object} o
 * @param {number} o.maxStrips
 * @param {number} o.along    arc parameter of this run, 0..1
 * @param {number} o.load     normalised local weight, 0 = hairline, 1 = swell
 * @param {number} o.ink      the run's overall opacity (break / faint)
 * @param {function(number,number,number):number} o.alphaAt
 */
export function drawBandChunk(ctx, band, from, to, o) {
  const strips = Math.max(1, Math.min(o.maxStrips, 1 + Math.round(o.load * 3)));
  for (let j = 0; j < strips; j++) {
    const t0 = j / strips, t1 = (j + 1) / strips;
    ctx.beginPath();
    for (let i = from; i <= to; i++) {
      const O = band.outer[i], N = band.inner[i];
      const x = N[0] + (O[0] - N[0]) * t1;
      const y = N[1] + (O[1] - N[1]) * t1;
      if (i === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = to; i >= from; i--) {
      const O = band.outer[i], N = band.inner[i];
      ctx.lineTo(N[0] + (O[0] - N[0]) * t0, N[1] + (O[1] - N[1]) * t0);
    }
    ctx.closePath();
    const a = o.alphaAt((t0 + t1) * 0.5, o.along, o.load) * o.ink;
    if (a < 0.02) continue;
    ctx.fillStyle = `rgba(0,0,0,${a.toFixed(4)})`;
    ctx.fill();
  }
}

/**
 * The striation pattern: how much ink a given streak carries.
 *
 * Nearly solid with interruptions. The hairline is the most solid part — a
 * fine pen line does not tear — and the separation grows with load, which is
 * where a loaded swell shows lengthwise gaps. The cutoff below `skip` is
 * where the tip missed the glass entirely.
 */
export function striations(seed, style) {
  const across = fbm1(mulberry32(seed ^ 0x7feb352d), 3);
  const along = fbm1(mulberry32(seed ^ 0x846ca68b), 3);
  const [tearLo, tearHi] = STROKE.tear;
  return (t, u, load) => {
    const n = 0.62 * across(u * 2.6 + t * 4.7) + 0.38 * along(u * 6.9 + t * 10.3);
    const k = (tearLo + (tearHi - tearLo) * clamp01(load)) * style.inkRoughness;
    let a = 1 - k * (1 - n);
    a *= smoothstep(0.05, STROKE.skip + 0.16 * style.inkRoughness, n);
    return clamp01(a);
  };
}

/* ═══ scratch trails and ticks ══════════════════════════════════════════ */

/** sample the drawn ring path at an arbitrary angle */
function sampler(path) {
  const n = path.length - 1;
  const a0 = path[0].a;
  return (a) => {
    let u = (((a - a0) % TAU) + TAU) % TAU / TAU;
    const f = u * n;
    const i = Math.min(n - 1, Math.floor(f));
    const fr = f - i;
    const p = path[i], q = path[i + 1];
    let nx = lerp(p.nx, q.nx, fr), ny = lerp(p.ny, q.ny, fr);
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl; ny /= nl;
    return { x: lerp(p.x, q.x, fr), y: lerp(p.y, q.y, fr), nx, ny };
  };
}

/**
 * Scratch trails beside the ring, and dry ticks along it.
 *
 * The references are full of these: where the brush dragged along the circle
 * and only its edge touched, leaving two or three fine parallel scratches
 * running well past the mass. Almost all of them live near a cluster — they
 * are the tail of the same movement — so anchors come in from glyph.js.
 *
 * @returns {{trails: Array, ticks: Array}}
 */
export function ringTrails({ path, ringHalf, seed, rng, anchors, style }) {
  const at = sampler(path);
  const trails = [];
  const splat = style.microSplatter;

  for (const anchor of anchors) {
    const count = ri(rng, STROKE.trails[0], STROKE.trails[1]);
    for (let t = 0; t < count; t++) {
      const side = rng() < 0.65 ? 1 : -1;
      const dir = rng() < 0.5 ? -1 : 1;
      const from = anchor.a + rr(rng, -0.35, 0.35);
      const span = rr(rng, STROKE.trailSpan[0], STROKE.trailSpan[1]) * (0.7 + 0.6 * rng());
      const off0 = rr(rng, 0.7, 2.2) * ringHalf * side;
      const grow = rr(rng, 0.4, 1.8);
      const steps = ri(rng, 8, 16);
      const wob = fbm1(mulberry32((rng() * 4294967296) >>> 0), 2);
      const ph = rng() * 90;
      const w = ringHalf * rr(rng, 0.16, 0.55);
      const alpha = rr(rng, 0.09, 0.30) * (0.7 + 0.5 * splat);

      /* a trail occasionally splits into two parallel scratches — the
         bristles of one brush edge, not one line */
      const sibs = rng() < 0.25 ? 1 : 0;
      for (let s = 0; s <= sibs; s++) {
        const sOff = off0 + s * ringHalf * rr(rng, 0.25, 0.9) * side;
        const sAlpha = alpha * (s === 0 ? 1 : rr(rng, 0.5, 0.9));
        const pts = [];
        for (let k = 0; k < steps; k++) {
          const u = k / (steps - 1);
          const P = at(from + dir * u * span);
          const off = sOff * (1 + (grow - 1) * u)
                    + (wob(u * 3 + ph + s) - 0.5) * ringHalf * 1.3;
          pts.push([P.x + P.nx * off, P.y + P.ny * off]);
        }
        trails.push({ pts, w: w * (s === 0 ? 1 : rr(rng, 0.6, 1)), a: clamp01(sAlpha) });
      }
    }
  }

  const ticks = [];
  const nTicks = Math.round(ri(rng, STROKE.ticks[0], STROKE.ticks[1]) * (0.5 + 0.7 * splat));
  const tickAt = anchors.length ? anchors : [{ a: 0 }];
  for (let i = 0; i < nTicks; i++) {
    let a;
    if (rng() < 0.62) {
      const an = tickAt[Math.floor(rng() * tickAt.length)];
      a = an.a + (rng() + rng() - 1) * 0.9;
    } else {
      a = rr(rng, 0, TAU);
    }
    const len = rr(rng, 0.008, 0.045);
    const dir = rng() < 0.5 ? -1 : 1;
    const P = at(a);
    const off = (rng() + rng() - 1) * 2.4 * ringHalf;
    const steps = ri(rng, 2, 4);
    const pts = [];
    for (let k = 0; k <= steps; k++) {
      const aa = a + dir * (k / steps) * len;
      const Q = at(aa);
      const o2 = off + (rng() - 0.5) * ringHalf * 0.8;
      pts.push([Q.x + Q.nx * o2, Q.y + Q.ny * o2]);
    }
    ticks.push({
      pts,
      w: ringHalf * rr(rng, 0.12, 0.45),
      a: rr(rng, 0.12, 0.45) * (0.6 + 0.6 * splat),
    });
  }

  return { trails, ticks };
}

/** draw trails and ticks as round-capped polyline strokes */
export function drawTrails(ctx, list) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const m of list) {
    if (!m.pts.length) continue;
    ctx.beginPath();
    ctx.moveTo(m.pts[0][0], m.pts[0][1]);
    for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i][0], m.pts[i][1]);
    ctx.lineWidth = m.w;
    ctx.strokeStyle = `rgba(0,0,0,${m.a.toFixed(4)})`;
    ctx.stroke();
  }
}
