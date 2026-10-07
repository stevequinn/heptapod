/* ═══════════════════════════════════════════════════════════════════════════
   The offshoots.

   The filaments that leave a wet mass, and the spatter thrown with them. These
   are the most reliably-got-wrong part of a logogram, and every wrong guess
   here has been a plausible one, so the measurements are worth writing down
   before the code:

     length         0.34 R at the median, 0.53 at p90, 0.80 at the maximum,
                    measured from the ring outward. They are LONG.
     cross-section  0.032 R at the root — about *hairline* weight. Not a
                    fraction of the mass, which is the tempting assumption and
                    makes them five times too heavy.
     direction      median 41 degrees off the outward radial, p10 67, p90 20.
                    Near-isotropic with a radial lean — a splash, not a comb and
                    not a starburst.
     count          about 11 per logogram reach past 1.2 R; range 2 to 35.
     profile        slow taper to a small rounded cap: fitting the measured
                    cross-section gives w(u) = w0 * (0.18 + 0.82 (1-u)^0.42).
                    At low resolution the tips look *clubbed*, and that reading
                    is an artefact of downscaling — measuring the profile along
                    each filament shows it falling monotonically. Worth knowing
                    because the clubbed reading survives looking at the images
                    and only the numbers kill it.
     spatter        about 56 detached dots, each 0.011 R across, ~1% of the ink
                    area, clustered within about 1.5 R of the centre.
   ═══════════════════════════════════════════════════════════════════════════ */

import { OFFSHOOT, SPATTER } from '../config.js';
import { TAU, fbm1, mulberry32, ri, rr } from '../lib/math.js';

/** how many points along a filament; enough for the bow and the undulation to
 *  read, few enough that the round-capped segments stay cheap */
const SEGMENTS = 14;

/**
 * Sample a mass's half-width at an arbitrary angle away from its centre.
 * Returns 0 outside the mass's arc.
 */
function massWidthAt(mass, da) {
  if (Math.abs(da) > mass.halfSpan) return 0;
  const t = (da / mass.halfSpan + 1) * 0.5;
  const k = Math.max(0, Math.min(mass.widths.length - 1,
    Math.round(t * (mass.widths.length - 1))));
  return mass.widths[k];
}

/**
 * Filaments leaving the masses.
 *
 * Roots are placed on the nominal ring and the mass is expected to cover them —
 * both are the same black, so the root is invisible and the filament appears to
 * emerge from the blob. The drawn length is therefore the visible length plus
 * however much of the root the mass swallows, or every filament would come out
 * short by the width of the blob it is leaving.
 *
 * Geometry is built here, once, and never in `draw()`. `draw()` is re-executed
 * whenever a mark is rebuilt at a new scale, so anything random in there would
 * make a logogram change shape when the window resizes.
 *
 * @param {Array<{angle,halfSpan,widths,strength}>} masses
 * @param {function} rng
 * @param {number} hairline
 * @param {number} seed
 * @returns {Array<{pts: Array<[number,number]>, ws: number[], reach: number}>}
 */
export function filaments({ masses, rng, hairline, seed }) {
  const out = [];
  if (!masses.length) return out;

  /* Share the population out by mass weight, so a heavy deposit throws more
   * than a light one, then clamp the total. */
  const total = masses.reduce((s, m) => s + m.strength, 0);
  const want = Math.round(rr(rng, OFFSHOOT.count[0], OFFSHOOT.count[1]));

  for (const mass of masses) {
    const share = Math.max(0, want * (mass.strength / total));
    const n = Math.max(mass.strength > 0.9 ? 2 : 0, Math.round(share));

    const wob = fbm1(mulberry32((seed + Math.round(mass.angle * 1e6)) >>> 0), 2);
    const ph = rng() * 90;

    /* Clumps: a few origins along the mass, each with its own direction, and
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
      const a0 = mass.angle + at * mass.halfSpan * rr(rng, OFFSHOOT.outlet[0], OFFSHOOT.outlet[1]);
      const localW = massWidthAt(mass, a0 - mass.angle);

      /* Direction: the clump's own direction plus a fan, which reproduces the
       * measured distribution while keeping a bunch coherent. */
      const roll = cl.dir + (rng() + rng() - 1) * OFFSHOOT.clumpFan;
      const phi = a0 + roll;
      const cosD = Math.cos(roll);

      const skew = Math.pow(rng(), OFFSHOOT.lengthSkew);
      const visible = (OFFSHOOT.length[0]
                    + (OFFSHOOT.length[1] - OFFSHOOT.length[0]) * skew)
                    * (0.72 + 0.42 * (mass.strength / 1.3))
                    // a few long outliers, as every reference has — capped, so
                    // that the longest base filaments cannot overshoot
                    * (rng() < 0.08 ? rr(rng, 1.5, 2.1) : 1);
      const capped = Math.min(visible, OFFSHOOT.maxLength);
      // add back what the mass will swallow, so `visible` is what shows
      const cover = localW * 0.5 * Math.abs(cosD);
      const len = capped + cover;

      const w0 = hairline * rr(rng, OFFSHOOT.width[0], OFFSHOOT.width[1])
               * (0.75 + 0.5 * mass.strength);
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
 * Clustered at the mass and thinning outward rather than spread evenly over the
 * frame — the references have real speckle, but all of it near the blobs. A
 * third are stretched into teardrops, which is what a dot thrown through air
 * looks like.
 *
 * @returns {Array<{x,y,r,ry,rot}>}
 */
export function specks({ masses, rng, hairline }) {
  const out = [];
  for (const mass of masses) {
    const n = ri(rng, SPATTER.perMass[0], SPATTER.perMass[1]);
    for (let i = 0; i < n; i++) {
      /* An angular position on or just off the mass, and a radial distance that
       * is mostly small — a power curve keeps the cloud tight. */
      const a = mass.angle + rr(rng, -1.0, 1.0) * mass.halfSpan * 1.35;
      const d = 1 + Math.pow(rng(), 1.7) * SPATTER.reach[1] * (rng() < 0.5 ? 1 : -1);
      const r = rr(rng, SPATTER.size[0], SPATTER.size[1]) * (0.85 + 0.35 * mass.strength);
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
  void hairline;
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
