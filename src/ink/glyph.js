/* ═══════════════════════════════════════════════════════════════════════════
   Logogram construction.

   One logogram, one way of making it. A glyph is a list of weighted `ops` in a
   LOCAL unit space where the ring radius is 1 and the centre is the origin.
   `ops` is drawn progressively, so the ink appears to be laid down by a limb
   rather than appearing whole.

   The structure is Wolfram's, and it is the one part of his notebooks that
   survives contact with the reference figures: sectionBreaking-01.nb divides a
   logogram into twelve angular wedges (sectionCount = 12), and this file
   generates from that. Where the blots sit, how heavy the circle runs and where
   it lifts off the glass are all described *per sector*, so each glyph's
   identity is a profile around the circle. Hand-placing a few blobs, as an
   earlier version did, gives a similar-looking result with far less variety.

   What does NOT come from his notebooks is the ink itself. The automaton is
   gone from this path entirely; blot.js explains why at length.

   Order matters below. The widths have to be known before the band is built,
   because the band *is* the mark, and the blot profile is its width.
   ═══════════════════════════════════════════════════════════════════════════ */

import { GLYPH, BLOT } from '../config.js';
import { TAU, fbm1, angDiff, clamp, lerp, smoothstep, mulberry32, rr, ri } from '../lib/math.js';
import { blotProfile } from './blot.js';
import { filaments, specks, drawFilaments, drawSpecks } from './offshoots.js';
import {
  ringProfile, ringBand, drawBandChunk, striations, dryTexture, drawDryTexture,
} from './stroke.js';
import { plumeTile } from './smoke.js';

/**
 * Build one ring logogram.
 *
 * @param {number} seed   any integer; the glyph is fully determined by it
 * @returns {{ops: Array, total: number, sectors: Array, seed: number}}
 */
export function makeRingGlyph(seed) {
  const rng = mulberry32(seed >>> 0);
  const nWob = [fbm1(rng, 4), fbm1(rng, 3), fbm1(rng, 3)];
  const nW = fbm1(rng, 4);
  const p0 = rr(rng, 0, 90), p1 = rr(rng, 0, 90), p2 = rr(rng, 0, 90), p3 = rr(rng, 0, 90);

  const SECTORS = GLYPH.sectors;
  const sectorAngle = TAU / SECTORS;

  /* ---- the twelve-sector ink profile --------------------------------- */
  /* One value per sector: how heavily inked this wedge of the circle is. Low
     frequency, so neighbouring sectors group into arcs — a real logogram has
     runs of calm and runs of heaviness, not twelve unrelated marks.

     The contrast curve matters more than it looks. Summing three noises gives a
     range of roughly 0.35 to 0.65, and feeding that straight into the rest of
     the file produces a profile where every sector is within 15% of every
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

  /* ---- where the blots sit -------------------------------------------- */
  /* At the profile's local maxima, at least `minApart` sectors apart. Taking
     the global top-N instead would put two blots two sectors apart whenever the
     noise has one broad hump, and two neighbouring blots just read as one very
     thick patch. */
  const wanted = ri(rng, GLYPH.blots[0], GLYPH.blots[1]);
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
  // walk on from the strongest and take what is free
  const from = peaks.length ? peaks[0].s : 0;
  for (let k = 0; k < SECTORS && chosen.length < wanted; k++) {
    const sec = (from + k) % SECTORS;
    if (!chosen.includes(sec)) chosen.push(sec);
  }

  const ringHalf = rr(rng, GLYPH.ring[0], GLYPH.ring[1]);

  /* Blot placement, then the spans resolved. Done in two steps because a span
     has to be limited by how many blots there are: two neighbouring blots
     spanning half the circle each just read as one very thick patch. */
  const placed = chosen.map((s) => ({
    angle: (s + 0.5) * sectorAngle + rr(rng, -0.16, 0.16),
    strength: clamp(0.34 + profile[s] * 1.05, 0.20, 1.35),
    rawSpan: rr(rng, BLOT.span[0], BLOT.span[1]) * (0.85 + 0.30 * profile[s]),
  }));

  /* ---- the blots ------------------------------------------------------- */
  const blotData = placed.map((m) => {
    const halfSpan = Math.min(m.rawSpan, TAU / (placed.length * 2) - 0.06);
    const { widths, peak } = blotProfile({
      halfSpan, ringHalf, strength: m.strength, rng,
    });
    return { angle: m.angle, halfSpan, widths, peak, strength: m.strength };
  });

  /* Heaviest leads. Almost every reference has one dominant blot and a quiet
     circle elsewhere; giving all the blots comparable weight produces a ring
     that is uniformly lumpy, which reads as a wobbling circle rather than as a
     written mark. */
  blotData.sort((x, y) => y.strength - x.strength);

  /* ---- gaps ----------------------------------------------------------- */
  /* Where the profile falls near zero the stroke lifts off the glass. This
     thins the swell rather than removing the stroke — the references are closed
     rings whose weight fades to nothing in places, not broken circles. */
  const gaps = [];
  for (let s = 0; s < SECTORS; s++) {
    if (profile[s] < 0.22 && rng() < 0.34) {
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

  const startA = blotData[0].angle;

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

  const { widths, peak } = ringProfile({
    blots: blotData, sectorProfile: profile, ringHalf, samples: N + 1, flowAt,
  });
  const band = ringBand({ path, widths, seed, peak });
  const ink = striations(seed);

  const ops = [];
  const CHUNK = 4;
  const STRIPS = 8;

  /* ---- the stroke ------------------------------------------------------ */
  for (let s = 0; s < N; s += CHUNK) {
    const e = Math.min(s + CHUNK, N);
    /* mean load over the run: the bristle spacing follows the pressure, and a
       per-sample value would tear the streaks sideways at every chunk join */
    let load = 0;
    for (let i = s; i < e; i++) load += widths[i];
    load /= (e - s) * (peak || 1);
    ops.push({
      w: 3,
      draw: (ctx) => drawBandChunk(ctx, band, s, e, {
        maxStrips: STRIPS, along: (s + e) / (2 * N), load, alphaAt: ink,
      }),
      /* The limb tip, wet-only: it exists only while the stroke is being laid
         down, so baking it in would leave a fringe of spikes round the ring. */
      tip: (ctx) => limbTip(ctx, path[e - 1], ringHalf),
    });
  }

  /* ---- dry brush over the footprint ------------------------------------ */
  const marks = dryTexture({ path, widths, seed, ringHalf });
  for (let part = 0; part < 3; part++) {
    const slice = marks.filter((_, i) => i % 3 === part);
    if (!slice.length) continue;
    ops.push({ w: 0.5, dryOnly: true, draw: (ctx) => drawDryTexture(ctx, slice) });
  }

  /* ---- the offshoots --------------------------------------------------- */
  /* After the circle, so their roots land on top of the blot and vanish into it.
     Split into batches purely so they arrive over a few frames rather than all
     at once — the geometry was computed in one place, above. */
  const fil = filaments({ blots: blotData, rng, ringHalf, seed });
  const BATCHES = 4;
  for (let b = 0; b < BATCHES; b++) {
    const slice = fil.filter((_, i) => i % BATCHES === b);
    if (!slice.length) continue;
    ops.push({ w: 1.1, draw: (ctx) => drawFilaments(ctx, slice) });
  }

  const dots = specks({ blots: blotData, rng });
  if (dots.length) {
    // faint last: spatter is the driest thing on the glass
    ops.push({ w: 1.4, draw: (ctx) => drawSpecks(ctx, dots) });
  }

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
          ctx.lineWidth = ringHalf * P.m * 1.3;
          ctx.strokeStyle = `rgba(0,0,0,${P.a})`;
          ctx.stroke();
        }
      },
    });
  }

  /* ---- interior plume --------------------------------------------------- */
  /* One localised wisp, heavily clipped. The haze is deliberately not clipped to
     the ring: in the film it drifts across the stroke and spills outside it,
     which is much of why the glyph reads as ink on glass rather than as a drawn
     circle. The reference *figures* have no haze on them, which is why the
     comparison tool has an ink-only view. */
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
    ops, total, seed,
    sectors: profile, sectorAngle,
    path, widths, ringHalf,
    blots: blotData, peak,
    filaments: fil, specks: dots,
    profileAt,
  };
}

/**
 * The limb's tip: a wedge trailing the head of the stroke. Only meaningful
 * while the stroke is being laid down, hence wet-only.
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
