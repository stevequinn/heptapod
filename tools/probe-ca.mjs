/* ═══════════════════════════════════════════════════════════════════════════
   Which of Wolfram's rules survive his own selection test?
   ═══════════════════════════════════════════════════════════════════════════

   ca-01.nb generates random rules, runs each for 700 steps from a binarised
   logogram, and keeps the ones where

     frames[[-1]] != frames[[-2]]            -- still evolving at the end, and
     BorderDimensions[last] < BorderDimensions[first]   -- the ink's bounding
                                                  box has not grown

   This reproduces that test headlessly so the rule list in src/ca/rules.js is
   measured rather than guessed. Run:  node tools/probe-ca.mjs
*/

const WOLFRAM_RULES = [
  174826, 174688, 174794, 175164, 175950, 176510, 175780,
  192184, 175622, 176632, 47808, 207594, 256576,
];

const IDX = (m, s) => 9 * s + m;

function table(rule) {
  const t = new Uint8Array(18);
  for (let s = 0; s < 2; s++) for (let m = 0; m < 9; m++) t[9 * s + m] = (rule >> IDX(m, s)) & 1;
  return t;
}

/** one generation, edges clamped (the notebook pads with empty) */
function step(a, b, w, h, t) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : a[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = at(x - 1, y - 1) + at(x, y - 1) + at(x + 1, y - 1)
              + at(x - 1, y) + at(x + 1, y)
              + at(x - 1, y + 1) + at(x, y + 1) + at(x + 1, y + 1);
      b[y * w + x] = t[9 * a[y * w + x] + n];
    }
  }
}

function run(rule, seed, w, h, steps) {
  const t = table(rule);
  // copy the seed: writing into the caller's array is an easy slip here,
  // because the swap below hands the original buffer back to be written on
  // the second generation
  let a = Uint8Array.from(seed);
  let b = new Uint8Array(w * h);
  for (let s = 0; s < steps; s++) {
    step(a, b, w, h, t);
    const tmp = a; a = b; b = tmp;
  }
  return a;
}

/** {xmin,xmax,ymin,ymax} of the ink, or null if there is none */
function border(a, w, h) {
  let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      if (!a[y * W + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  return x1 < 0 ? null : { xmin: x0, xmax: x1, ymin: y0, ymax: y1 };
}

/**
 * The test as the notebook literally writes it:
 *
 *   EuclideanDistance @@ BorderDimensions[frame]
 *
 * `@@` threads over the 4-list and `EuclideanDistance` is binary, so this
 * evaluates as EuclideanDistance[{xmin,xmax},{ymin,ymax}] — pairing the x
 * extent against the y extent, NOT the diagonal of the bounding box. For any
 * roughly centred, roughly symmetric pattern that is ~0 whether the ink is a
 * thin ring or has filled the frame, because {xmin,xmax} and {ymin,ymax} are
 * the same pair either way.
 */
const literal = (b) => Math.hypot(b.xmin - b.ymin, b.xmax - b.ymax);

/** the diagonal of the bounding box, i.e. what the expression looks like it
 *  was meant to mean */
const diag = (b) => Math.hypot(b.xmax - b.xmin, b.ymax - b.ymin);

/** the seed: a ring, as the binarised logogram would be. 120 = 100 + 2x10 pad */
const W = 120, H = 120;
function ringSeed() {
  const a = new Uint8Array(W * H);
  const cx = 59.5, cy = 59.5, R = 44;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
      const wob = R * (1 + 0.05 * Math.sin(3 * th + 1.1));
      if (Math.abs(r - wob) < 2) a[y * W + x] = 1;
    }
  // and a couple of deposits, as a real logogram has
  for (const [ang, s] of [[-2.15, 4], [1.48, 3]]) {
    const kx = cx + Math.cos(ang) * R, ky = cy + Math.sin(ang) * R;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (Math.hypot(x - kx, y - ky) < s) a[y * W + x] = 1;
  }
  return a;
}

const seed = ringSeed();
const seedBox = border(seed, W, H);
const seedInk = seed.reduce((a, b) => a + b, 0);
const seedLit = literal(seedBox);
const seedDiag = diag(seedBox);

console.log(`seed: ${W}x${H}, ${seedInk} ink cells`);
console.log(`  BorderDimensions ${JSON.stringify(seedBox)}`);
console.log(`  literal  EuclideanDistance@@Border = ${seedLit.toFixed(2)}`);
console.log(`  intended bounding-box diagonal     = ${seedDiag.toFixed(2)}\n`);

console.log('rule      ink@700  newInk  stillMoving  literal@@  intended  passes(literal)  passes(intended)');
const passLit = [], passDia = [];
for (const rule of WOLFRAM_RULES) {
  const out = run(rule, seed, W, H, 700);
  const prev = run(rule, seed, W, H, 699);
  const ink = out.reduce((a, b) => a + b, 0);
  let fresh = 0;
  for (let i = 0; i < out.length; i++) if (out[i] && !seed[i]) fresh++;
  let moving = false;
  for (let i = 0; i < out.length; i++) if (out[i] !== prev[i]) { moving = true; break; }
  const box = border(out, W, H);
  const lit = box ? literal(box) : 0;
  const dg = box ? diag(box) : 0;
  const okLit = moving && lit < seedLit;
  const okDia = moving && dg <= seedDiag;
  if (okLit) passLit.push(rule);
  if (okDia) passDia.push(rule);
  console.log(
    `${String(rule).padStart(6)}  ${String(ink).padStart(7)}  ${String(fresh).padStart(6)}  ` +
    `${String(moving).padStart(11)}  ${lit.toFixed(2).padStart(9)}  ${dg.toFixed(1).padStart(8)}  ` +
    `${(okLit ? 'YES' : '-').padStart(15)}  ${(okDia ? 'YES' : '-').padStart(15)}`,
  );
}

console.log(`\npassing the filter as literally written: ${passLit.length}/13  [${passLit.join(', ')}]`);
console.log(`passing the intended bounding-box test: ${passDia.length}/13  [${passDia.join(', ')}]`);

