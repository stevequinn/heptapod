/* ═══════════════════════════════════════════════════════════════════════════
   The offshoots.

   The filaments that leave a wet blot, and the spatter thrown with them.

   The rule that matters most here, and the one that was wrong for a long time:

     spikes leave BLOTS. Never the thin circle.

   That is true of all 38 reference frames without exception, and it is obvious
   the moment the whole set is looked at in one place — which is why the review
   page has a view for exactly that. The failure mode is subtle in code: emit
   from "the blot's arc" and a blot whose profile has tapered to almost nothing
   at its own edge still emits, so filaments sprout from places where the ink is
   hairline thin and the picture reads as a hairy circle rather than as a
   splashed one. Emission is therefore gated on the *local blot weight*, not on
   being nominally inside a blot's arc.

   The rest of it, measured:

     length         0.09 R at the median and 0.24 at p90, measured with a
                    distance transform so that a spike lying along a ray cannot
                    inflate itself. They are SHORT. Earlier estimates of 0.34 to
                    0.53 came from measuring rays, which counts a spike as part
                    of whatever it touches.
     cross-section  comparable to the ring itself, not to the blot they leave.
                    Assuming they scale with the blot makes them several times
                    too heavy, and it is a very natural assumption.
     direction      near-isotropic with a slight outward lean — a splash, not a
                    comb and not a starburst.
     count          twenty to fifty per logogram, in clumps rather than evenly
                    spaced.
     profile        tapers to a *rounded* point. At low resolution the tips look
                    clubbed; that reading is an artefact of downscaling, and it
                    survives looking at the images — only measuring kills it.
     spatter        detached dots clustered on the blots, about 1% of the ink by
                    area.
   ═══════════════════════════════════════════════════════════════════════════ */

import { OFFSHOOT, SPATTER } from '../config.js';
import { TAU, fbm1, mulberry32, ri, rr } from '../lib/math.js';

/** how many points along a filament; enough for the bow and the undulation to
 *  read, few enough that the round-capped segments stay cheap */
const SEGMENTS = 14;

/**
 * Sample a blot's half-width at an arbitrary angle away from its centre.
 * Returns 0 outside the blot's arc.
 */
function blotWidthAt(blot, da) {
  if (Math.abs(da) > blot.halfSpan) return 0;
  const t = (da / blot.halfSpan + 1) * 0.5;
  const k = Math.max(0, Math.min(blot.widths.length - 1,
    Math.round(t * (blot.widths.length - 1))));
  return blot.widths[k];
}

/**
 * Filaments leaving the blots.
 *
 * Roots are placed on the nominal ring and the blot is expected to cover them —
 * both are the same black, so the root is invisible and the filament appears to
 * emerge from the blot. The drawn length is therefore the visible length plus
 * however much of the root the blot swallows, or every filament would come out
 * short by the width of the blot it is leaving.
 *
 * Emission is confined to blots *and* gated on the local blot weight, which are
 * not the same thing: see the header.
 *
 * Geometry is built here, once, and never in `draw()`. `draw()` is re-executed
 * whenever a mark is rebuilt at a new scale, so anything random in there would
 * make a logogram change shape when the window resizes.
 *
 * @param {Array<{angle,halfSpan,widths,peak,strength}>} blots
 * @param {function} rng
 * @param {number} ringHalf
 * @param {number} seed
 * @returns {Array<{pts: Array<[number,number]>, ws: number[], reach: number}>}
 */
export function filaments({ blots, rng, ringHalf, seed }) {
  const out = [];
  if (!blots.length) return out;

  /* Share the population out by blot weight, so a heavy blot throws more
   * than a light one, then clamp the total. */
  const total = blots.reduce((s, m) => s + m.strength, 0);
  const want = Math.round(rr(rng, OFFSHOOT.count[0], OFFSHOOT.count[1]));

  for (const blot of blots) {
    const share = Math.max(0, want * (blot.strength / total));
    const n = Math.max(blot.strength > 0.9 ? 2 : 0, Math.round(share));

    const wob = fbm1(mulberry32((seed + Math.round(blot.angle * 1e6)) >>> 0), 2);
    const ph = rng() * 90;

    /* Clumps: a few origins along the blot, each with its own direction, and
       the filaments grouped around them. This is what the references' fringes
       actually look like — bunches fanning from near the same point, with bare
       stretches between — and it is the difference between a splash and a
       comb. */
    const nClump = ri(rng, OFFSHOOT.clumps[0], OFFSHOOT.clumps[1]);
    const clumps = [];
    for (let c = 0; c < nClump; c++) {
      clumps.push({
        at: rr(rng, -0.88, 0.88),
        dir: (rng() + rng() + rng() - 1.5) * OFFSHOOT.spread,
      });
    }

    for (let i = 0; i < n; i++) {
      const cl = clumps[Math.floor(rng() * clumps.length)];
      const at = Math.max(-1, Math.min(1, cl.at + (rng() + rng() - 1) * OFFSHOOT.clumpSpread));
      const a0 = blot.angle + at * blot.halfSpan * rr(rng, OFFSHOOT.outlet[0], OFFSHOOT.outlet[1]);
      const localW = blotWidthAt(blot, a0 - blot.angle);
      /* The gate. A blot's profile falls to nothing at the ends of its own arc,
         so "inside the arc" is not the same as "on thick ink" — and filaments
         emitted from the thin ends are exactly the hairy-circle failure. */
      if (localW < blot.peak * OFFSHOOT.minLoad) continue;

      /* Direction: the clump's own direction plus a fan, which reproduces the
       * measured distribution while keeping a bunch coherent. */
      const roll = cl.dir + (rng() + rng() - 1) * OFFSHOOT.clumpFan;
      const phi = a0 + roll;
      const cosD = Math.cos(roll);

      const skew = Math.pow(rng(), OFFSHOOT.lengthSkew);
      const visible = (OFFSHOOT.length[0]
                    + (OFFSHOOT.length[1] - OFFSHOOT.length[0]) * skew)
                    * (0.72 + 0.42 * (blot.strength / 1.3))
                    // a few long outliers, as every reference has — capped, so
                    // that the longest base filaments cannot overshoot
                    * (rng() < 0.08 ? rr(rng, 1.5, 2.1) : 1);
      const capped = Math.min(visible, OFFSHOOT.maxLength);
      // add back what the blot will swallow, so `visible` is what shows
      const cover = localW * 0.5 * Math.abs(cosD);
      const len = capped + cover;

      const w0 = ringHalf * rr(rng, OFFSHOOT.width[0], OFFSHOOT.width[1])
               * (0.75 + 0.5 * blot.strength);
      const bow = rr(rng, OFFSHOOT.bow[0], OFFSHOOT.bow[1]) * (rng() < 0.5 ? -1 : 1);

      const dx = Math.cos(phi), dy = Math.sin(phi);
      const px = -dy, py = dx;
      const pts = new Array(SEGMENTS);
      const ws = new Array(SEGMENTS);
      const r0 = Math.cos(a0), r1 = Math.sin(a0);

      for (let s = 0; s < SEGMENTS; s++) {
        const t = s / (SEGMENTS - 1);
        /* A slight arc, and a very slight kink so it is not obviously a
           generated curve. Both are small on purpose: these are stiff liquid
           jets, and a filament long enough to read as one is also long enough
           that any appreciable bow closes it into a loop, which reads as
           spaghetti and is the single most conspicuous way to get this wrong. */
        const lat = (Math.sin(Math.PI * t) * bow + (wob(t * 1.7 + ph) - 0.5) * 0.12) * len;
        pts[s] = [r0 + dx * len * t + px * lat, r1 + dy * len * t + py * lat];

        /* The measured cross-section: a slow taper to a small cap, not a cone.
         * `tipCap` is what the round cap on the last segment turns into the
         * rounded end. */
        const taper = OFFSHOOT.tipCap + (1 - OFFSHOOT.tipCap)
                    * Math.pow(1 - t, OFFSHOOT.taper);
        // visible nodes and swells along the length; straight cones read as grass
        const und = 1 + OFFSHOOT.undulate * (wob(t * OFFSHOOT.undPeriods + ph * 0.5) - 0.5) * 2;
        ws[s] = Math.max(1e-4, w0 * taper * und);
      }

      out.push({ pts, ws, reach: len * Math.max(0, cosD) });
    }
  }
  return out;
}

/**
 * Draw filaments as chains of round-capped segments.
 *
 * Per-segment lineWidth is the only way to get a tapering tube out of the 2D
 * canvas, and the round cap on the final segment is exactly the rounded end the
 * measurement calls for — a polygon outline would have to be told about it
 * separately, and would get it wrong.
 *
 * Segments are short and overlap, so the caps fuse into a smooth tube. Alpha is
 * 1 throughout: the reference filaments are solid black, and a translucent one
 * would double-darken wherever its own caps overlapped.
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

/**
 * Spatter: detached dots thrown where the ink flicked.
 *
 * Clustered at the blot and thinning outward rather than spread evenly over the
 * frame — the references have real speckle, but all of it near the blobs. A
 * third are stretched into teardrops, which is what a dot thrown through air
 * looks like.
 *
 * @returns {Array<{x,y,r,ry,rot}>}
 */
export function specks({ blots, rng }) {
  const out = [];
  for (const blot of blots) {
    const n = ri(rng, SPATTER.perMass[0], SPATTER.perMass[1]);
    for (let i = 0; i < n; i++) {
      /* An angular position on or just off the blot, and a radial distance that
       * is mostly small — a power curve keeps the cloud tight. */
      const a = blot.angle + rr(rng, -1.0, 1.0) * blot.halfSpan * 1.35;
      const d = 1 + Math.pow(rng(), 1.7) * SPATTER.reach[1] * (rng() < 0.5 ? 1 : -1);
      const r = rr(rng, SPATTER.size[0], SPATTER.size[1]) * (0.85 + 0.35 * blot.strength);
      const stretched = rng() < SPATTER.stretched;
      out.push({
        x: Math.cos(a) * d,
        y: Math.sin(a) * d,
        r,
        ry: stretched ? r * rr(rng, 1.6, 3.4) : r,
        rot: a + Math.PI / 2,        // stretched along the throw, not across it
      });
    }
  }
  return out;
}

export function drawSpecks(ctx, dots) {
  ctx.fillStyle = '#000';
  for (const d of dots) {
    ctx.beginPath();
    ctx.ellipse(d.x, d.y, d.r, d.ry, d.rot, 0, TAU);
    ctx.fill();
  }
}
