/* ═══════════════════════════════════════════════════════════════════════════
   Logogram construction.

   A glyph is a list of weighted `ops` in a LOCAL unit space where the ring
   radius is 1 and the centre is the origin. `ops` is drawn progressively, so
   the ink appears to be laid down by a limb rather than appearing whole.

   The structural idea here is Wolfram's. sectionBreaking-01.nb divides a
   logogram into twelve angular wedges — sectionCount = 12 — and that is the
   vocabulary this file generates from: the ink weight of the ring, its
   deposits and its gaps are all described *per sector*, so each glyph's
   identity is a profile around the circle. Hand-placing a few pools, as an
   earlier version did, gives a similar-looking result with far less variety.

   The deposits themselves grow by cellular automaton (ca/), using rule
   numbers Wolfram selected from ca-01.nb.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, CA } from '../config.js';
import { TAU, fbm1, angDiff, clamp, lerp, smoothstep, mulberry32, rr, ri } from '../lib/math.js';
import { growDeposit, proceduralDeposit } from '../ca/growth.js';
import { rasteriseGlyph, growWhole } from '../ca/whole.js';
import { plumeTile } from './smoke.js';

/**
 * Build one ring logogram.
 *
 * @param {number} seed   any integer; the glyph is fully determined by it
 * @param {object} [opts]
 * @param {'deposit'|'whole'|'procedural'} [opts.mode]  how the ink deposits
 *   are grown. 'deposit' and 'whole' both use Wolfram's rules; they differ in
 *   what seeds them — a disc at each deposit, or the entire rasterised
 *   logogram as ca-01.nb does. 'procedural' grows no automaton at all.
 * @returns {{ops: Array, total: number, sectors: Array, seed: number}}
 */
export function makeRingGlyph(seed, { mode = 'deposit' } = {}) {
  const ca = mode !== 'procedural';
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
  // fall back to the heaviest unused sectors if the profile has too few peaks
  for (let s = 0; s < SECTORS && chosen.length < wanted; s++) {
    const order = s + peaks.indexOf(peaks[0]);
    const sec = order % SECTORS;
    if (!chosen.includes(sec)) chosen.push(sec);
  }

  const blots = chosen.map((s) => {
    const v = profile[s];
    return {
      a: (s + 0.5) * sectorAngle + rr(rng, -0.14, 0.14),
      strength: clamp(0.30 + v * 1.0, 0.18, 1.3),
      spread: 0.022 + v * 0.024 + rr(rng, 0, 0.010),
    };
  });
  // the largest deposit leads the stroke: the limb starts where the ink is
  // thickest
  blots.sort((x, y) => y.strength - x.strength);

  /* ---- gaps ----------------------------------------------------------- */
  /* Where the profile falls near zero the stroke lifts off the glass. */
  const gaps = [];
  for (let s = 0; s < SECTORS; s++) {
    if (profile[s] < 0.22 && rng() < 0.75) {
      gaps.push({ a: (s + 0.5) * sectorAngle + rr(rng, -0.10, 0.10), width: rr(rng, 0.10, 0.26) });
    }
  }
  const gapAt = (a) => {
    let flow = 1;
    for (const gap of gaps) {
      const d = Math.abs(angDiff(a, gap.a));
      flow *= smoothstep(gap.width * 0.7, gap.width * 1.3, d);
    }
    return flow;
  };

  const startA = blots[0].a;

  /* ---- the wobbly ring path ------------------------------------------ */
  const N = GLYPH.pathSegments;
  const ecc = rr(rng, -0.055, 0.055);
  const path = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const a = startA + u * TAU;
    let r = 1;
    r += 0.19 * (nWob[0]((a / TAU) * 3 + p0) - 0.5);
    r += 0.075 * (nWob[1]((a / TAU) * 7 + p1) - 0.5);
    r += 0.026 * (nWob[2]((a / TAU) * 17 + p2) - 0.5);
    const cx = Math.cos(a) * r, cy = Math.sin(a) * r;
    path.push({ x: cx * (1 + ecc), y: cy * (1 - ecc), a, r, u: clamp(u, 0, 1) });
  }
  const pathAt = (a) => {
    const u = (((a - startA) % TAU) + TAU) % TAU / TAU;
    return path[Math.min(N, Math.round(u * N))];
  };

  /* ---- stroke weight --------------------------------------------------- */
  /* Kept thin on purpose: the film's ring is a scratchy pen line whose peak
     alpha is well under 1, and weight here is the main thing that turns the
     glyph from ink into a bold graphic circle. */
  const base = rr(rng, GLYPH.stroke[0], GLYPH.stroke[1]);
  const widthAt = (p) => {
    let w = base * (0.40 + 0.36 * nW(p.u * 4.6 + p3));
    // the sector profile decides how much ink this stretch of the circle holds
    w *= 0.46 + 0.98 * profileAt(p.a);
    // and the deposits swell the stroke locally, which is what makes a pool
    // read as a pool rather than as a slightly bolder line
    for (const b of blots) {
      const d = angDiff(p.a, b.a);
      w += base * b.strength * 3.4 * Math.exp(-(d * d) / (0.16 * 0.16));
    }
    w *= 0.68 + 0.32 * smoothstep(0, 0.045, p.u) * (0.5 + 0.5 * smoothstep(1, 0.94, p.u));
    return w;
  };

  const ops = [];

  /* ---- the ring stroke, chunked so it can grow segment by segment ----- */
  /* Wide and faint, then narrow and dark. The film stroke is a dry brush with
     an intermittent core, so no single pass describes it. */
  const PASSES = [
    { m: 2.40, a: 0.010, gate: 0.35 },
    { m: 1.90, a: 0.017, gate: 0.55 },
    { m: 1.15, a: 0.034, gate: 0.80 },
    { m: 0.62, a: 0.075, gate: 1.00 },
    { m: 0.30, a: 0.220, gate: 1.00 },
    { m: 0.15, a: 0.400, gate: 1.00 },
  ];
  const CHUNK = 5;
  for (let s = 0; s < N; s += CHUNK) {
    const e = Math.min(s + CHUNK, N);
    const mid = path[Math.min(s + 1, N)];
    const w = widthAt(mid);
    const jitter = 0.92 + rng() * 0.16;
    /* Per-segment pressure. Holding the tip down unevenly is what makes the
       stroke dry and intermittent — the line nearly vanishes in places and
       thickens where the limb lingered. Two rates are mixed so the line has
       both slow swells and fast chatter; one rate alone reads as a wobble. */
    const press = [];
    for (let i = s; i < e; i++) {
      const slow = nW(i * 0.055 + p0 * 3);
      const fast = nW(i * 0.85 + p1 * 7);
      press.push(0.06 + 1.30 * (0.55 * slow + 0.45 * fast));
    }

    const op = {
      w: CHUNK * (0.6 + nW(s * 0.07 + p1) * 0.9),
      head: path[e - 1],
      // the whole-glyph automaton seeds from the stroke itself, so the ring
      // ops are the only ones marked as seed geometry
      isRing: true,
      draw(ctx) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (let pi = 0; pi < PASSES.length; pi++) {
          const P = PASSES[pi];
          for (let i = s; i < e; i++) {
            const a0 = path[i], a1 = path[i + 1];
            if (!a0 || !a1) continue;
            const flow = gapAt(a0.a);
            if (flow < 0.015) continue;
            const pr = Math.min(1.35, press[i - s]);
            if (pr * flow < 0.05) continue;      // the tip has lifted off
            const j = 0.003;
            const ax = a0.x + Math.sin(i * 17.1 + a0.a * 3.1) * j;
            const ay = a0.y + Math.cos(i * 9.4 + a1.a * 1.7) * j;
            const bx = a1.x + Math.sin((i + 1) * 17.1 + a1.a * 3.1) * j;
            const by = a1.y + Math.cos((i + 1) * 9.4 + a0.a * 1.7) * j;
            // how much this pass obeys the pressure gate
            const gate = lerp(1, pr, P.gate);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(bx, by);
            ctx.lineWidth = w * P.m * jitter * 2 * (0.25 + 0.75 * flow) * Math.max(0.15, gate);
            ctx.strokeStyle = `rgba(0,0,0,${(P.a * flow * gate).toFixed(4)})`;
            ctx.stroke();
          }
        }
      },
    };

    /* The limb tip. It exists only while the stroke is being drawn, so it is
       marked wet-only and painted to the evaporating buffer — baking it in
       would leave a fringe of spikes all around the finished ring. */
    const h = op.head;
    const a = h.a + Math.PI / 2;
    const L = base * 5.0, W = base * 2.3;
    op.tip = (ctx) => {
      ctx.beginPath();
      ctx.moveTo(h.x - Math.cos(a) * L, h.y - Math.sin(a) * L);
      ctx.quadraticCurveTo(h.x - Math.cos(a) * L * 0.28, h.y - Math.sin(a) * L * 0.28, h.x, h.y);
      ctx.quadraticCurveTo(h.x + Math.cos(a) * W * 0.9, h.y + Math.sin(a) * W * 0.9,
        h.x - Math.cos(a) * L * 0.40, h.y - Math.sin(a) * L * 1.25);
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fill();
    };
    ops.push(op);
  }

  /* ---- ink growth ------------------------------------------------------ */
  /* `ops` already holds the ring stroke, so in 'whole' mode the logogram can be
     rasterised and run through the automaton now, exactly as ca-01.nb does —
     the ring is the initial condition, not decoration around it. */
  const growthOps = [];
  let lastRule = null;
  if (mode === 'whole') {
    const g = growWhole(rasteriseGlyph({ ops, blots }), rng, seed);
    lastRule = g.rule;
    growthOps.push(...inkFromGrowth(g, nW, p1));
  }

  blots.forEach((b, bi) => {
    const isMain = bi === 0;

    if (mode === 'whole') {
      /* the deposits' filaments already came from the whole-glyph run, so only
         the knot, the long strands and the spatter are drawn here */
      growthOps.push(...depositFurniture(b, isMain, nW, rng, base, p0, bi));
      return;
    }

    const bx = Math.cos(b.a), by = Math.sin(b.a);
    const grown = ca
      ? growDeposit({
          angle: b.a, spread: b.spread, rng, seed: seed + bi * 7919,
          strength: clamp(b.strength, 0.15, 1),
        })
      : proceduralDeposit({ angle: b.a, spread: b.spread, rng, strength: b.strength });

    /* growDeposit works in a patch centred on the knot, so its filaments come
       back in knot-local coordinates. Move them onto the ring. */
    const moved = {
      strokes: grown.strokes.map((h) => ({
        ...h, x0: h.x0 + bx, y0: h.y0 + by, x1: h.x1 + bx, y1: h.y1 + by,
      })),
      pools: (grown.pools ?? []).map((p) => ({ ...p, x: p.x + bx, y: p.y + by })),
    };
    lastRule = grown.rule ?? lastRule;

    growthOps.push(...inkFromGrowth(moved, nW, p1, bi));
    growthOps.push(...depositFurniture(b, isMain, nW, rng, base, p0, bi));
  });

  ops.push(...growthOps);

  /* ---- streaks dragged along the stroke ------------------------------- */
  /* Torn brush edge where the deposit pooled, without giving up the calm
     nearly-empty stretches of the circle. */
  const drag = [];
  for (const b of blots)
    for (let i = 0; i < 40 * b.strength; i++) {
      drag.push({
        a: b.a + rr(rng, -0.30, 0.30),
        span: rr(rng, 0.04, 0.19) * (rng() < 0.5 ? -1 : 1),
        offset: rr(rng, -0.065, 0.065),
        width: rr(rng, 0.002, 0.014) * b.strength,
        alpha: rr(rng, 0.045, 0.26),
      });
    }
  for (let part = 0; part < 3; part++) {
    const slice = drag.filter((_, i) => i % 3 === part);
    ops.push({
      w: 0.6,
      draw(ctx) {
        ctx.lineCap = 'round';
        for (const f of slice) {
          for (let k = 0; k < 10; k++) {
            const t = k / 10, q = (k + 1) / 10;
            const a = f.a + f.span * t, b = f.a + f.span * q;
            const p = pathAt(a), nx = pathAt(b);
            const off = f.offset * (0.6 + 0.4 * Math.sin(Math.PI * t));
            ctx.beginPath();
            ctx.moveTo(p.x + Math.cos(a) * off, p.y + Math.sin(a) * off);
            ctx.lineTo(nx.x + Math.cos(b) * off, nx.y + Math.sin(b) * off);
            ctx.lineWidth = f.width * (0.18 + 0.82 * Math.sin(Math.PI * (t + 0.05)));
            ctx.strokeStyle = `rgba(0,0,0,${(f.alpha * (0.3 + 0.7 * Math.sin(Math.PI * (t + 0.05)))).toFixed(4)})`;
            ctx.stroke();
          }
        }
      },
    });
  }

  /* ---- faint interior scratches -------------------------------------- */
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
        for (const P of [{ m: 3.0, a: 0.008 }, { m: 1.4, a: 0.014 }, { m: 0.6, a: 0.026 }]) {
          let pen = false;
          ctx.beginPath();
          for (const s of steps) {
            const x = Math.cos(s.a) * s.r, y = Math.sin(s.a) * s.r;
            if (!s.on) { pen = false; continue; }
            if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
          }
          ctx.lineWidth = base * P.m * 1.3;
          ctx.strokeStyle = `rgba(0,0,0,${P.a})`;
          ctx.stroke();
        }
      },
    });
  }

  /* ---- interior plume -------------------------------------------------- */
  /* One localised wisp, heavily clipped. The ink haze is deliberately not
     clipped to the ring: in the reference it drifts across the stroke and
     spills outside it, which is a big part of why the glyph reads as ink on
     glass rather than as a drawn circle. */
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
    ops, total, blots, path, base, N,
    sectors: profile, sectorAngle, seed,
    mode,
    /** which Wolfram rule this glyph's growth came from, for the read-out */
    rule: lastRule,
  };
}

/**
 * Turn traced growth geometry into ink ops: the wet mass (pools) first, then
 * the filaments in three passes so a burst builds over several frames rather
 * than landing all at once.
 *
 * Shared by both automaton modes — the only difference between them is what
 * seeded the growth and how big the cells are.
 *
 * @param {{strokes: Array, pools: Array}} grown
 * @param {function} nW   the glyph's noise, for pool edge irregularity
 * @param {number} p1     phase offset
 * @param {number} bi     which deposit, for decorrelating edges
 */
function inkFromGrowth(grown, nW, p1, bi = 0) {
  const ops = [];
  const { strokes: hairs = [], pools = [] } = grown;

  /* The wet mass under the burst. Without this a deposit is a spray of faint
     specks, which reads as dust rather than as ink. */
  for (let part = 0; part < 2; part++) {
    const slice = pools.filter((_, i) => i % 2 === part);
    if (!slice.length) continue;
    ops.push({
      w: 0.7,
      draw(ctx) {
        for (const p of slice) {
          ctx.beginPath();
          for (let i = 0; i <= p.lobes; i++) {
            const a = p.rot + (i / p.lobes) * TAU;
            const rad = p.r * (1 - p.rough * 0.5 + p.rough * nW(a * 3.1 + bi * 7 + p1));
            const x = p.x + Math.cos(a) * rad, y = p.y + Math.sin(a) * rad;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fillStyle = `rgba(0,0,0,${(p.a * (part === 0 ? 1 : 0.55)).toFixed(4)})`;
          ctx.fill();
        }
      },
    });
  }

  /* Filaments: a wide faint underpass, then narrower and darker. */
  const batches = [
    { m: 2.4, a: 0.26, every: 3 },
    { m: 1.4, a: 0.50, every: 2 },
    { m: 1.0, a: 1.00, every: 1 },
  ];
  let cursor = 0;
  for (const P of batches) {
    const slice = hairs.filter((_, i) => i % P.every === cursor % P.every);
    cursor++;
    if (!slice.length) continue;
    ops.push({
      w: 0.85,
      draw(ctx) {
        ctx.lineCap = 'round';
        for (const h of slice) taperStroke(ctx, h, P.m, P.a * h.a);
      },
    });
  }
  return ops;
}

/**
 * The parts of a deposit that are not the automaton's business: the dense knot
 * the burst radiates from, a few long strands, and the fine spatter at the
 * edge of the ink.
 */
function depositFurniture(b, isMain, nW, rng, base, p0, bi) {
  const ops = [];
  const bx = Math.cos(b.a), by = Math.sin(b.a);
  const knotR = base * (2.0 + 3.0 * b.strength);

  ops.push({
    w: 0.9,
    draw(ctx) {
      ctx.beginPath();
      for (let i = 0; i <= 22; i++) {
        const a = (i / 22) * TAU;
        const rad = knotR * (0.42 + 0.30 * nW(a * 2.1 + bi * 5 + p0));
        const x = bx + Math.cos(a) * rad, y = by + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      ctx.fill();
    },
  });

  /* Long strands, only from the principal deposit. Fine and curved: a few
     thick straight blades read as grass. The curl stays small and the length
     long, because a big curl on a short strand closes into a visible loop. */
  if (isMain) {
    const n = ri(rng, 7, 13);
    const strands = [];
    for (let i = 0; i < n; i++) {
      const tangent = b.a + Math.PI / 2;
      const side = rng() < 0.5 ? -1 : 1;
      const dir = tangent * side + rr(rng, -1.1, 1.1);
      const len = rr(rng, 0.12, 0.34) * (0.5 + b.strength);
      strands.push({
        x0: bx, y0: by,
        x1: bx + Math.cos(dir) * len,
        y1: by + Math.sin(dir) * len,
        w: rr(rng, 0.0035, 0.009) * (0.5 + b.strength),
        a: rr(rng, 0.14, 0.34),
        curl: rr(rng, -0.22, 0.22),
      });
    }
    ops.push({
      w: 0.9,
      draw(ctx) { for (const s of strands) taperStroke(ctx, s, 1, s.a); },
    });
  }

  /* fine spatter, kept close to the deposit — the reference has almost no
     far-flung detached dots, just tatter at the edge of the ink */
  const drops = ri(rng, 16, 34);
  const dropDefs = [];
  for (let i = 0; i < drops; i++) {
    const a = rr(rng, 0, TAU);
    const t = Math.pow(rng(), 1.7);
    dropDefs.push({
      x: bx + Math.cos(a) * knotR * (1.1 + t * 3.2),
      y: by + Math.sin(a) * knotR * (1.1 + t * 3.2),
      r: knotR * (0.012 + 0.06 * Math.pow(rng(), 2.4)) * (1 - t * 0.75),
      a: rr(rng, 0.12, 0.45) * (1 - t * 0.65),
      sq: rr(rng, 0.7, 1.3),
    });
  }
  ops.push({
    w: 1.8,
    dryOnly: true,
    draw(ctx) {
      for (const d of dropDefs) {
        if (d.r < 0.0018 || d.a < 0.02) continue;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, d.r, d.r * d.sq, 0, 0, TAU);
        ctx.fillStyle = `rgba(0,0,0,${d.a.toFixed(4)})`;
        ctx.fill();
      }
    },
  });

  return ops;
}

/**
 * A tapered stroke: constant-width strokes are the giveaway that a filament is
 * a line, not a hair. This swells at the root and dies to a point, and bows,
 * because a perfectly straight filament looks drawn where ink curls.
 */
function taperStroke(ctx, h, widthMul, alpha) {
  const dx = h.x1 - h.x0, dy = h.y1 - h.y0;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len, py = dx / len;
  const SEG = 8;
  const left = [], right = [];
  for (let i = 0; i <= SEG; i++) {
    const u = i / SEG;
    const bow = Math.sin(Math.PI * u) * (h.curl ?? 0.12) * len;
    const x = h.x0 + dx * u + px * bow;
    const y = h.y0 + dy * u + py * bow;
    const w = (h.w * Math.pow(1 - u, 0.75) + 0.0002) * widthMul;
    left.push([x - px * w, y - py * w]);
    right.push([x + px * w, y + py * w]);
  }
  ctx.beginPath();
  ctx.moveTo(left[0][0], left[0][1]);
  for (const p of left.slice(1)) ctx.lineTo(p[0], p[1]);
  for (const p of right.reverse()) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fillStyle = `rgba(0,0,0,${Math.max(0, alpha).toFixed(4)})`;
  ctx.fill();
}
