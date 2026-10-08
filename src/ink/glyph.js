/* ═══════════════════════════════════════════════════════════════════════════
   Logogram construction.

   One logogram, one way of making it. A glyph is a list of weighted `ops` in a
   LOCAL unit space where the ring radius is 1 and the centre is the origin.
   `ops` is drawn progressively, so the ink appears to be laid down by a limb
   rather than appearing whole.

   The structure is Wolfram's: sectionBreaking-01.nb divides a logogram into
   twelve angular wedges (sectionCount = 12), and this file generates from
   that. Where the dense deposits sit, how heavy the circle runs and where it
   lifts off the glass are all described around the circle, so each glyph's
   identity is a profile rather than a handful of hand-placed blobs.

   The composition is four layers, and the order is deliberate:

     1. the ring — one band, varying in weight, occasionally broken
     2. the clusters — hundreds of accumulated strokes per deposit, never a
        filled shape; see blot.js for why that distinction is the whole game
     3. the bristles — generated from the strokes they grow out of
     4. scratches, dry ticks and flecks — the driest marks on the glass

   `makeRingGlyph(seed, style)` accepts the style overrides from config.js so
   the review page can calibrate the look without touching code.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, resolveStyle } from '../config.js';
import { TAU, angDiff, clamp, clamp01, fbm1, lerp, mulberry32, rr } from '../lib/math.js';
import {
  clusterShape, clusterMarks, clusterWidthAt, drawStrokes, drawFlakes,
} from './blot.js';
import { filaments, specks, drawFilaments, drawSpecks } from './offshoots.js';
import {
  ringProfile, ringBand, drawBandChunk, striations, ringTrails, drawTrails,
} from './stroke.js';
import { plumeTile } from './smoke.js';

/**
 * Build one ring logogram.
 *
 * @param {number} seed   any integer; the glyph is fully determined by it
 * @param {object} [style]  overrides for STYLE (clusterDensity, ringWobble…)
 * @returns {{ops:Array, total:number, sectors:Array, seed:number, blots:Array,
 *            filaments:Array, specks:Array, peak:number, widths:Float32Array}}
 */
export function makeRingGlyph(seed, style = {}) {
  const S = resolveStyle(style);
  const rng = mulberry32(seed >>> 0);

  const SECTORS = GLYPH.sectors;
  const sectorAngle = TAU / SECTORS;

  /* ---- noise tables ---------------------------------------------------- */
  const nWob = [fbm1(rng, 4), fbm1(rng, 3), fbm1(rng, 3)];
  const nW = fbm1(rng, 4);
  const p0 = rr(rng, 0, 90), p1 = rr(rng, 0, 90), p2 = rr(rng, 0, 90), p3 = rr(rng, 0, 90);

  /* ---- the twelve-sector ink profile ----------------------------------- */
  /* One value per sector: how heavily inked this wedge of the circle is. Low
     frequency, so neighbouring sectors group into runs of calm and runs of
     heaviness. The smoothstep expands the useful band of the summed noise
     back out to 0..1, or every sector ends up within 15% of every other and
     the profile does nothing. */
  const profile = [];
  for (let s = 0; s < SECTORS; s++) {
    const u = s / SECTORS;
    const v =
      0.52 * nWob[1](u * 2.0 + p0) +
      0.30 * nWob[2](u * 3.0 + p1) +
      0.18 * nWob[0](u * 1.0 + p2);
    profile.push(clamp01((v - 0.40) / 0.22));
  }

  const profileAt = (a) => {
    const u = ((((a % TAU) + TAU) % TAU) / TAU) * SECTORS;
    const i = Math.floor(u), f = u - i;
    const a0 = profile[((i % SECTORS) + SECTORS) % SECTORS];
    const a1 = profile[(i + 1) % SECTORS];
    return lerp(a0, a1, f * f * (3 - 2 * f));
  };

  const ringHalf = rr(rng, GLYPH.ring[0], GLYPH.ring[1]);
  const startA = rr(rng, 0, TAU);

  /* ---- the ring path --------------------------------------------------- */
  /* Compass-guided, so still clearly a circle: three octaves of radial
     wobble plus a little ellipticity, scaled by STYLE.ringWobble. The old
     version was so round it read as vector; this is a hand-drawn circle, not
     a scribble. */
  const N = GLYPH.pathSegments;
  const [wLo, wMid, wHi] = GLYPH.wobble;
  const wb = S.ringWobble;
  const ecc = rr(rng, GLYPH.eccentricity[0], GLYPH.eccentricity[1]) * (rng() < 0.5 ? -1 : 1);
  const path = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = startA + u * TAU;
    const r = 1
      + wb * wLo * (nWob[0]((a / TAU) * 3 + p0) - 0.5) * 2
      + wb * wMid * (nWob[1]((a / TAU) * 7 + p1) - 0.5) * 2
      + wb * wHi * (nWob[2]((a / TAU) * 17 + p2) - 0.5) * 2;
    const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    path.push({
      x: cx * (1 + ecc), y: cy * (1 - ecc),
      nx: Math.cos(a) * (1 + ecc), ny: Math.sin(a) * (1 - ecc),
      a, r, u,
    });
  }
  path[N] = { ...path[0], u: 1 };

  /** the path, sampled at an arbitrary absolute angle with a unit normal */
  const pathAt = (a) => {
    const u = ((((a - startA) % TAU) + TAU) % TAU) / TAU;
    const f = u * N;
    const i = Math.min(N - 1, Math.floor(f));
    const fr = f - i;
    const p = path[i], q = path[i + 1];
    const nx0 = lerp(p.nx, q.nx, fr), ny0 = lerp(p.ny, q.ny, fr);
    const nl = Math.hypot(nx0, ny0) || 1;
    return {
      x: lerp(p.x, q.x, fr), y: lerp(p.y, q.y, fr),
      nx: nx0 / nl, ny: ny0 / nl,
    };
  };

  /* ---- where the clusters sit ------------------------------------------ */
  const wanted = clamp(Math.round(S.clusterCount + (rng() * 2 - 1) * 0.9), 1, 5);
  const order = [];
  for (let s = 0; s < SECTORS; s++) order.push({ s, v: profile[s] * rr(rng, 0.7, 1.3) });
  order.sort((x, y) => y.v - x.v);

  const chosen = [];
  for (const o of order) {
    if (chosen.length >= wanted) break;
    const far = chosen.every((c) => {
      const d = Math.min(Math.abs(c - o.s), SECTORS - Math.abs(c - o.s));
      return d >= 2;
    });
    if (far) chosen.push(o.s);
  }
  for (let k = 0; k < SECTORS && chosen.length < wanted; k++) {
    if (!chosen.includes(k)) chosen.push(k);
  }

  /* Strength from the profile, then a deliberate imbalance: one deposit
     dominates. Comparable weights everywhere read as a wobbling circle
     rather than as a written mark. A per-glyph inkiness multiplier widens
     the spread from whisper-light to heavily worked, because the corpus
     ranges from 6% ink to 17% and a generator that only makes the median is
     not making the family. */
  const inkiness = rr(rng, 0.78, 1.35);
  const raw = chosen.map((s) => ({ s, v: (0.40 + 1.0 * profile[s]) * rr(rng, 0.75, 1.3) * inkiness }));
  raw.sort((x, y) => y.v - x.v);
  raw.forEach((r, i) => { r.v *= i === 0 ? 1.35 : i === 1 ? 0.90 : 0.72; });

  const clusters = raw.map(({ s, v }, idx) => {
    const compact = rng() < 0.40;
    const halfSpan = (compact ? rr(rng, 0.10, 0.26) : rr(rng, 0.22, 0.60))
                   * (0.9 + 0.25 * profile[s]);
    const strength = clamp(v * (compact ? 1.10 : 0.95), 0.3, 1.5);
    const angle = (s + 0.5) * sectorAngle + rr(rng, -0.22, 0.22);
    return clusterShape({ angle, halfSpan, ringHalf, strength, rng, style: S });
  });
  clusters.sort((x, y) => y.strength - x.strength);

  const peak = Math.max(...clusters.map((c) => c.maxWidth), ringHalf * 3);

  /* ---- the ring's width, breaks and faints ----------------------------- */
  const { widths: ringWidths, ink } = ringProfile({
    profileAt, ringHalf, samples: N + 1, a0: startA, seed, rng,
    avoid: clusters.map((c) => ({ a: c.angle, h: c.halfSpan })),
    bumps: clusters.map((c) => ({
      a: c.angle, h: c.halfSpan,
      amp: 0.45 + 0.60 * clamp01(c.strength / 1.5),
    })),
    style: S,
  });
  const band = ringBand({ path, widths: ringWidths, ringHalf, seed, style: S });
  const inkAlpha = striations(seed, S);

  /* Composite width per angle, for the probe: the ring, or the cluster
     envelope where it reaches further. Breaks read as no ink. */
  const widths = new Float32Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const a = startA + (i / N) * TAU;
    let m = ink[i] > 0.3 ? ringWidths[i] : 0;
    for (const c of clusters) {
      const w = clusterWidthAt(c, a);
      if (w > m) m = w;
    }
    widths[i] = m;
  }

  /* ---- the marks ------------------------------------------------------- */
  const built = clusters.map((shape) => ({
    shape,
    marks: clusterMarks({ shape, rng, pathAt, style: S }),
  }));

  const pools = { strokes: [], deposits: [], flakes: [], fringe: [], sweeps: [], scratches: [] };
  const clusterRefs = [];
  for (const b of built) {
    for (const k of Object.keys(pools)) pools[k].push(...b.marks[k]);
    clusterRefs.push({ shape: b.shape, anchors: b.marks.anchors });
  }

  const fil = filaments({ clusters: clusterRefs, rng, ringHalf, seed, style: S, pathAt });
  const dots = specks({ clusters: clusterRefs, rng, style: S });

  const trails = ringTrails({
    path, ringHalf, seed, rng,
    anchors: clusters.map((c) => ({ a: c.angle })),
    style: S,
  });

  /* ---- ops ------------------------------------------------------------- */
  const ops = [];

  /** push a list as several batches, so nothing arrives all at once */
  const pushBatches = (list, batchSize, weight, draw, group) => {
    if (!list.length) return;
    for (let i = 0; i < list.length; i += batchSize) {
      const slice = list.slice(i, i + batchSize);
      ops.push({ w: weight * (slice.length / list.length), g: group, draw: (ctx) => draw(ctx, slice) });
    }
  };

  /* 1. the ring, in chunks so the limb appears to travel */
  const CHUNK = 4;
  for (let s = 0; s < N; s += CHUNK) {
    const e = Math.min(s + CHUNK, N);
    let mi = 0, mw = 0;
    for (let i = s; i <= e; i++) { mi += ink[i]; mw += ringWidths[i]; }
    mi /= (e - s + 1);
    mw /= (e - s + 1);
    if (mi <= 0.15) continue;
    const load = clamp01((mw / ringHalf - 0.8) / 1.8);
    ops.push({
      w: 1.6 + 2.4 * load,
      g: 'ring',
      draw: (ctx) => drawBandChunk(ctx, band, s, e, {
        maxStrips: 4, along: (s + e) / (2 * N), load, ink: mi, alphaAt: inkAlpha,
      }),
      tip: (ctx) => limbTip(ctx, path[e - 1], ringHalf),
    });
  }

  /* 2. the clusters — sweeps first, then the body, then the wet core, then
        the damage to its boundary */
  pushBatches(pools.sweeps, 4, 0.8, drawStrokes, 'sweep');
  pushBatches(pools.strokes, 10, 1.0, drawStrokes, 'mass');
  pushBatches(pools.deposits, 8, 0.9, drawStrokes, 'mass');
  pushBatches(pools.fringe, 8, 0.8, drawStrokes, 'mass');
  pushBatches(pools.flakes, 8, 0.7, drawFlakes, 'mass');
  pushBatches(pools.scratches, 6, 0.7, drawStrokes, 'mass');

  /* 3. the bristles */
  pushBatches(fil, Math.max(1, Math.ceil(fil.length / 4)), 0.55, drawFilaments, 'bristle');

  /* 4. the driest marks: trails, ticks, flecks */
  pushBatches(trails.trails, 10, 0.5, drawTrails, 'trail');
  pushBatches(trails.ticks, 30, 0.35, drawTrails, 'tick');
  if (dots.length) ops.push({ w: 0.5, g: 'speck', draw: (ctx) => drawSpecks(ctx, dots) });

  /* ---- faint interior scratches ---------------------------------------- */
  const nGhost = riGhost(rng);
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
      g: 'ghost',
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
          ctx.lineWidth = ringHalf * P.m * 1.3;
          ctx.strokeStyle = `rgba(0,0,0,${P.a})`;
          ctx.stroke();
        }
      },
    });
  }

  /* ---- interior plume --------------------------------------------------- */
  /* One localised wisp, heavily clipped. The reference *figures* have no haze
     on them, which is why the review page has an ink-only view. */
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
      g: 'plume',
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
    ops, total, seed, style: S,
    sectors: profile, sectorAngle,
    path, widths, ringHalf,
    blots: clusters, peak,
    filaments: fil, specks: dots,
    profileAt,
  };
}

/** 0-2 barely-there interior pen marks */
function riGhost(rng) {
  const u = rng();
  return u < 0.45 ? 0 : u < 0.85 ? 1 : 2;
}

/**
 * The limb's tip: a wedge trailing the head of the stroke, wet-only. It
 * exists only while the stroke is being laid down, so baking it in would
 * leave a fringe of spikes round the ring.
 */
function limbTip(ctx, h, ringHalf) {
  const a = h.a + Math.PI / 2;
  const L = ringHalf * 5.0, W = ringHalf * 2.3;
  ctx.beginPath();
  ctx.moveTo(h.x - Math.cos(a) * L, h.y - Math.sin(a) * L);
  ctx.quadraticCurveTo(h.x - Math.cos(a) * L * 0.28, h.y - Math.sin(a) * L * 0.28, h.x, h.y);
  ctx.quadraticCurveTo(h.x + Math.cos(a) * W * 0.9, h.y + Math.sin(a) * W * 0.9,
    h.x - Math.cos(a) * L * 0.40, h.y - Math.sin(a) * L * 1.25);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fill();
}
