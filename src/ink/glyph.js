/* ═══════════════════════════════════════════════════════════════════════════
   Logogram construction.

   A glyph is a list of weighted `ops` in a LOCAL unit space where the ring
   radius is 1 and the centre is the origin. `ops` is drawn progressively, so
   the ink appears to be laid down by a limb rather than appearing whole.

   The structural idea here is Wolfram's. sectionBreaking-01.nb divides a
   logogram into twelve angular wedges — sectionCount = 12 — and that is the
   vocabulary this file generates from: the ink weight of the stroke, its
   deposits and its gaps are all described *per sector*, so each glyph's
   identity is a profile around the circle. Hand-placing a few pools, as an
   earlier version did, gives a similar-looking result with far less variety.

   The deposits themselves grow by cellular automaton (ca/), using rule numbers
   Wolfram selected from ca-01.nb. The automaton supplies a *measurement* —
   how deep the ink is at each angle around the deposit — and that becomes the
   stroke's width. It no longer supplies geometry, because geometry emitted by
   a grid reads as spatter, and none of the reference logograms look like that.

   Order matters below: the automaton has to run *before* the band is built,
   because the band is the stroke and the stroke's width is what it measured.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, CA, BRUSH } from '../config.js';
import { TAU, fbm1, angDiff, clamp, lerp, smoothstep, mulberry32, rr, ri } from '../lib/math.js';
import { growProfile, proceduralProfile, measureProfile, PROFILE_SAMPLES } from '../ca/growth.js';
import { rasteriseSeed, growGrid, project, WHOLE } from '../ca/whole.js';
import {
  ringProfile, ringBand, drawBandChunk, striations,
  dryTexture, drawDryTexture, drawBristles,
  offshoots, drawTaper, spatter, drawSpatter,
} from './brush.js';
import { plumeTile } from './smoke.js';

/**
 * Build one ring logogram.
 *
 * @param {number} seed   any integer; the glyph is fully determined by it
 * @param {object} [opts]
 * @param {'deposit'|'whole'|'procedural'} [opts.mode]  how the deposits are
 *   measured. 'deposit' runs one automaton per deposit, 'whole' runs one over
 *   the entire rasterised glyph as ca-01.nb does — so the deposits are
 *   correlated with each other rather than independent — and 'procedural' grows
 *   no automaton at all.
 * @returns {{ops: Array, total: number, sectors: Array, seed: number}}
 */
export function makeRingGlyph(seed, { mode = 'deposit' } = {}) {
  const rng = mulberry32(seed >>> 0);
  const nWob = [fbm1(rng, 4), fbm1(rng, 3), fbm1(rng, 3)];
  const nW = fbm1(rng, 4);
  const p0 = rr(rng, 0, 90), p1 = rr(rng, 0, 90), p2 = rr(rng, 0, 90), p3 = rr(rng, 0, 90);

  const SECTORS = GLYPH.sectors;
  const sectorAngle = TAU / SECTORS;

  /* ---- the twelve-sector ink profile --------------------------------- */
  /* One value per sector: how heavily inked this wedge of the circle is.
     Low frequency, so neighbouring sectors group into arcs — a real logogram
     has runs of calm and runs of heaviness, not twelve unrelated marks.

     The contrast curve matters more than it looks. Summing three noises gives
     a range of roughly 0.35 to 0.65, and feeding that straight into the rest
     of the file produces a profile where every sector is within 15% of every
     other — the twelve-sector structure is then doing nothing at all. The
     smoothstep expands the useful band back out to the full 0..1. */
  const profile = [];
  for (let s = 0; s < SECTORS; s++) {
    const u = s / SECTORS;
    const v =
      0.52 * nWob[1](u * 2.0 + p0) +
      0.30 * nWob[2](u * 3.0 + p1) +
      0.18 * nWob[0](u * 1.0 + p2);
    profile.push(smoothstep(0.40, 0.62, v));
  }

  /** interpolated profile at an arbitrary angle */
  const profileAt = (a) => {
    const u = (((a % TAU) + TAU) % TAU) / TAU * SECTORS;
    const i = Math.floor(u), f = u - i;
    const a0 = profile[((i % SECTORS) + SECTORS) % SECTORS];
    const a1 = profile[(i + 1) % SECTORS];
    return lerp(a0, a1, f * f * (3 - 2 * f));
  };

  /* ---- deposits ------------------------------------------------------- */
  /* Placed at the profile's local maxima, at least `minApart` sectors apart.
     Taking the global top-N instead would put two deposits two sectors apart
     whenever the noise has one broad hump, and two neighbouring deposits just
     read as one thick patch. */
  const wanted = ri(rng, GLYPH.deposits[0], GLYPH.deposits[1]);
  const minApart = 3;
  const peaks = [];
  for (let s = 0; s < SECTORS; s++) {
    const prev = profile[(s - 1 + SECTORS) % SECTORS];
    const next = profile[(s + 1) % SECTORS];
    if (profile[s] >= prev && profile[s] >= next) peaks.push({ s, v: profile[s] });
  }
  peaks.sort((x, y) => y.v - x.v);

  const chosen = [];
  for (const p of peaks) {
    if (chosen.length >= wanted) break;
    const far = chosen.every((c) => {
      const d = Math.min(Math.abs(c - p.s), SECTORS - Math.abs(c - p.s));
      return d >= minApart;
    });
    if (far) chosen.push(p.s);
  }
  // fall back to the heaviest unused sectors if the profile has too few peaks:
  // walk on from the strongest peak and take what is free
  const from = peaks.length ? peaks[0].s : 0;
  for (let k = 0; k < SECTORS && chosen.length < wanted; k++) {
    const sec = (from + k) % SECTORS;
    if (!chosen.includes(sec)) chosen.push(sec);
  }

  const blots = chosen.map((s, i) => {
    const v = profile[s];
    return {
      a: (s + 0.5) * sectorAngle + rr(rng, -0.14, 0.14),
      strength: clamp(0.34 + v * 1.05, 0.20, 1.35),
      /* the seed disc only has to be big enough to start the automaton; it is
         not the visible deposit any more */
      spread: 0.020 + v * 0.018 + rr(rng, 0, 0.008),
      /* the arc this deposit owns. Wider than one sector, because the blade in
         the references runs to well over a quarter of the circle */
      halfSpan: BRUSH.arcSpan * (0.80 + 0.40 * v) * (i === 0 ? 1.0 : 0.78),
    };
  });
  /* The heaviest deposit leads — the limb starts where the ink is thickest —
     and it leads by more than the profile's own spread. Almost every reference
     has one dominant mass and thin stroke elsewhere, and giving all the
     deposits comparable strength produces a ring that is uniformly lumpy, which
     reads as a wobbly circle rather than as a written mark. */
  blots.sort((x, y) => y.strength - x.strength);
  blots[0].strength = Math.min(1.6, blots[0].strength * 1.55);
  for (const b of blots) b.halfSpan = Math.min(b.halfSpan, TAU / (blots.length * 2) - 0.04);

  /* ---- gaps ----------------------------------------------------------- */
  /* Where the profile falls near zero the stroke lifts off the glass. This
     thins the blade rather than removing it — the references are closed rings
     whose stroke fades to nothing in places, not broken circles. */
  const gaps = [];
  for (let s = 0; s < SECTORS; s++) {
    if (profile[s] < 0.22 && rng() < 0.7) {
      gaps.push({ a: (s + 0.5) * sectorAngle + rr(rng, -0.10, 0.10), width: rr(rng, 0.09, 0.24) });
    }
  }
  const flowAt = (a) => {
    let flow = 1;
    for (const gap of gaps) {
      const d = Math.abs(angDiff(a, gap.a));
      flow *= smoothstep(gap.width * 0.65, gap.width * 1.35, d);
    }
    return flow;
  };

  const startA = blots[0].a;

  /* ---- the ring path -------------------------------------------------- */
  /* Compass-guided, so remarkably round. Amplitudes are GLYPH.wobble and are
     much smaller than a hand-drawn circle would want. */
  const N = GLYPH.pathSegments;
  const [wLo, wMid, wHi] = GLYPH.wobble;
  const ecc = rr(rng, -0.045, 0.045);
  const path = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = startA + u * TAU;
    let r = 1;
    r += wLo * (nWob[0]((a / TAU) * 3 + p0) - 0.5) * 2;
    r += wMid * (nWob[1]((a / TAU) * 7 + p1) - 0.5) * 2;
    r += wHi * (nWob[2]((a / TAU) * 17 + p2) - 0.5) * 2;
    const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    path.push({
      x: cx * (1 + ecc), y: cy * (1 - ecc),
      // the outward normal, which is what the band's edges follow
      nx: Math.cos(a) * (1 + ecc), ny: Math.sin(a) * (1 - ecc),
      a, r, u,
    });
  }
  path[N] = { ...path[0], u: 1 };        // close exactly, so the band has no seam

  /* ---- the automaton, and the measurement ----------------------------- */
  /* Before the band, not after: the band *is* the stroke, and the stroke's
     weight is what the automaton measured. */
  const hairline = rr(rng, GLYPH.stroke[0], GLYPH.stroke[1]);
  const bristles = [];
  let deposits;
  let rule = null;

  if (mode === 'whole') {
    /* One rule over the whole glyph, so the blades are correlated. */
    const g = growGrid(rasteriseSeed({ path, hairline, blots }), rng);
    rule = g.rule;
    deposits = blots.map((b) => ({
      angle: b.a,
      halfSpan: b.halfSpan,
      widths: measureProfile(g.grid, WHOLE.N, {
        project, angle: b.a, halfSpan: b.halfSpan,
        strength: b.strength, samples: PROFILE_SAMPLES,
      }),
    }));
  } else {
    deposits = blots.map((b, i) => {
      const grown = mode !== 'procedural'
        ? growProfile({
            angle: b.a, spread: b.spread, halfSpan: b.halfSpan, hairline,
            rng, seed: seed + i * 7919, strength: b.strength,
          })
        : proceduralProfile({ angle: b.a, halfSpan: b.halfSpan, rng, strength: b.strength });
      rule = grown.rule ?? rule;
      bristles.push(...(grown.bristles ?? []));
      return { angle: b.a, halfSpan: b.halfSpan, widths: grown.widths };
    });
  }

  /* ---- the stroke's width profile -------------------------------------- */
  const { widths, peak: bladePeak } = ringProfile({
    deposits, sectorProfile: profile, hairline, samples: N + 1, flowAt,
  });
  const targetMax = hairline * BRUSH.swellMax;

  /* ---- the stroke ------------------------------------------------------ */
  const band = ringBand({ path, widths, seed, targetMax });
  const ink = striations(seed);

  const ops = [];
  const CHUNK = 4;
  const STRIPS = BRUSH.strips;
  for (let s = 0; s < N; s += CHUNK) {
    const e = Math.min(s + CHUNK, N);
    /* mean load over the run: the bristle spacing follows the pressure, and a
       per-sample value would tear the streaks sideways at every chunk join */
    let load = 0;
    for (let i = s; i < e; i++) load += widths[i];
    load /= (e - s) * (targetMax || 1);
    ops.push({
      w: 3,
      draw: (ctx) => drawBandChunk(ctx, band, s, e, {
        strips: STRIPS, along: (s + e) / (2 * N), load, alphaAt: ink,
      }),
      /* The limb tip. It exists only while the stroke is being drawn, so it is
         marked wet-only and painted to the evaporating buffer — baking it in
         would leave a fringe of spikes all around the finished ring. */
      tip: (ctx) => limbTip(ctx, path[e - 1], hairline),
    });
  }

  /* ---- dry brush over the footprint ------------------------------------ */
  /* A clean filled band is the giveaway that a shape is vector. */
  const marks = dryTexture({ path, widths, seed, hairline });
  for (let part = 0; part < 3; part++) {
    const slice = marks.filter((_, i) => i % 3 === part);
    if (!slice.length) continue;
    ops.push({ w: 0.5, dryOnly: true, draw: (ctx) => drawDryTexture(ctx, slice) });
  }

  /* ---- bristles --------------------------------------------------------- */
  /* Over the wet part of the stroke, so they read as the brush's own texture
     rather than as a separate cloud of hair. Two passes, wide and faint then
     narrow and dark.

     Not marked dry-only: these are core ink, and the "ink only" view in
     tools/reference exists precisely so the stroke can be judged without the
     haze — putting the bristles behind that filter hid the single most
     characteristic thing about the references. */
  if (bristles.length) {
    for (let pi = 0; pi < 2; pi++) {
      const slice = bristles.filter((_, i) => i % 2 === pi);
      if (!slice.length) continue;
      const P = pi === 0 ? { m: 1.15, a: 0.35 } : { m: 0.7, a: 1.0 };
      ops.push({ w: 0.9, draw: (ctx) => drawBristles(ctx, slice, P.m, P.a) });
    }
  }

  /* ---- offshoots and spatter ------------------------------------------ */
  /* Both keyed off the blade's own width, so a thin stretch of stroke grows
     nothing and a loaded one throws a fan. */
  blots.forEach((b, bi) => {
    const spurs = offshoots({
      angle: b.a, halfSpan: b.halfSpan, widths: deposits[bi].widths,
      rng, strength: b.strength, targetMax,
    });
    if (spurs.length) {
      /* three passes, wide and faint to narrow and dark: an offshoot is a
         stroke, and a stroke has more than one way to lay down ink */
      const passes = [{ m: 1.5, a: 0.20 }, { m: 0.95, a: 0.50 }, { m: 0.45, a: 1.0 }];
      for (let pi = 0; pi < passes.length; pi++) {
        const P = passes[pi];
        const slice = spurs.filter((_, i) => i % passes.length === pi % passes.length);
        if (!slice.length) continue;
        ops.push({ w: 0.8, draw: (ctx) => { for (const s of slice) drawTaper(ctx, s, P.m, P.a); } });
      }
    }

    const dots = spatter({
      angle: b.a, widths: deposits[bi].widths, rng, hairline, targetMax, strength: b.strength,
    });
    if (dots.length) ops.push({ w: 0.7, dryOnly: true, draw: (ctx) => drawSpatter(ctx, dots, 1) });
  });

  /* ---- faint interior scratches ---------------------------------------- */
  /* Barely-there pen marks inside the ring. Very low alpha, broken. */
  const nGhost = ri(rng, 1, 3);
  for (let i = 0; i < nGhost; i++) {
    const ga = rr(rng, 0, TAU), gr = rr(rng, 0.26, 0.60);
    const gs = rr(rng, 0.5, 1.7), gph = rr(rng, 0, 90);
    const steps = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      steps.push({
        a: ga + t * gs,
        r: gr * (1 + 0.30 * (nWob[1](t * 3 + gph) - 0.5) * 2),
        on: rng() > 0.22,
      });
    }
    ops.push({
      w: 1.0,
      dryOnly: true,
      draw(ctx) {
        ctx.lineCap = 'round';
        for (const P of [{ m: 3.0, a: 0.004 }, { m: 1.4, a: 0.008 }, { m: 0.6, a: 0.014 }]) {
          let pen = false;
          ctx.beginPath();
          for (const s of steps) {
            if (!s.on) { pen = false; continue; }
            const x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r;
            if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
          }
          ctx.lineWidth = hairline * P.m * 1.3;
          ctx.strokeStyle = `rgba(0,0,0,${P.a})`;
          ctx.stroke();
        }
      },
    });
  }

  /* ---- interior plume --------------------------------------------------- */
  /* One localised wisp, heavily clipped. The haze is deliberately not clipped
     to the ring: in the reference it drifts across the stroke and spills outside
     it, which is much of why the glyph reads as ink on glass rather than as a
     drawn circle. */
  const plumeAng = rr(rng, 0, TAU);
  const plumeR = rr(rng, 0.06, 0.26);
  const px0 = Math.cos(plumeAng) * plumeR, py0 = Math.sin(plumeAng) * plumeR;
  const plumeR2 = rr(rng, GLYPH.plumeRadius[0], GLYPH.plumeRadius[1]);
  const plumeAlpha = rr(rng, GLYPH.plumeAlpha[0], GLYPH.plumeAlpha[1]);
  const smoke = plumeTile(rng);
  const SMOKE_STEPS = 5;
  for (let s = 1; s <= SMOKE_STEPS; s++) {
    const amt = s / SMOKE_STEPS;
    ops.push({
      w: 1.15,
      dryOnly: true,
      draw(ctx) {
        ctx.save();
        ctx.translate(px0, py0);
        ctx.globalAlpha *= plumeAlpha * amt * amt;
        ctx.drawImage(smoke, -plumeR2, -plumeR2, plumeR2 * 2, plumeR2 * 2);
        ctx.restore();
      },
    });
  }

  const total = ops.reduce((s, o) => s + o.w, 0);
  return {
    ops, total, blots, path, hairline, N,
    sectors: profile, sectorAngle, seed, mode,
    /** which Wolfram rule this glyph's growth came from, for the read-out */
    rule,
    /** the stroke's measured width at each path sample, ring radii */
    widths,
    /** widest point of the stroke, and the hairline it swells from */
    bladePeak, hairlineHalfWidth: targetMax,
  };
}

/* ---- local helpers ------------------------------------------------------ */

/**
 * The limb's tip: a wedge trailing the head of the stroke. Only meaningful
 * while the stroke is being laid down, hence wet-only.
 */
function limbTip(ctx, h, hairline) {
  const a = h.a + Math.PI / 2;
  const L = hairline * 5.0, W = hairline * 2.3;
  ctx.beginPath();
  ctx.moveTo(h.x - Math.cos(a) * L, h.y - Math.sin(a) * L);
  ctx.quadraticCurveTo(h.x - Math.cos(a) * L * 0.28, h.y - Math.sin(a) * L * 0.28, h.x, h.y);
  ctx.quadraticCurveTo(h.x + Math.cos(a) * W * 0.9, h.y + Math.sin(a) * W * 0.9,
    h.x - Math.cos(a) * L * 0.40, h.y - Math.sin(a) * L * 1.25);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fill();
}

