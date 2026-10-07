/* ═══════════════════════════════════════════════════════════════════════════
   Small maths + noise helpers shared by the ink, the CA and the unwrap view.

   The noise here is value noise on a seeded lattice rather than a permutation
   of a gradient table: it wraps, which matters because the ring path is a
   closed loop sampled periodically, and it stays cheap enough to build a
   few thousand fresh lattices per glyph.
   ═══════════════════════════════════════════════════════════════════════════ */

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Deterministic PRNG. Every glyph is reproducible from its seed alone, which
 * is what lets `?warm=` produce a byte-identical screenshot every run.
 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** float in [a, b) */
export const rr = (rng, a, b) => a + rng() * (b - a);
/** integer in [a, b] */
export const ri = (rng, a, b) => Math.floor(a + rng() * (b - a + 1));

export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

/** shortest signed angular difference, in (-PI, PI] */
export const angDiff = (a, b) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};

/**
 * 1-D fractal noise on a wrapped value-noise lattice.
 * Used for the ring's radius wobble and stroke weight, which must be periodic
 * in the path parameter or the ring closes with a visible seam.
 */
export function fbm1(rng, oct = 4) {
  const tabs = [];
  for (let o = 0; o < oct; o++) {
    const n = 64, t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = rng();
    tabs.push({ n, t });
  }
  return (x) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      const { n, t } = tabs[o];
      const xi = x * f, i = Math.floor(xi), fr = xi - i;
      const s0 = fr * fr * (3 - 2 * fr);
      const a = t[((i % n) + n) % n], b = t[(((i + 1) % n) + n) % n];
      s += amp * (a + (b - a) * s0);
      norm += amp;
      amp *= 0.5;
      f *= 2.07;
    }
    return s / norm;
  };
}

/** 2-D fractal value noise, used for the ink haze inside a glyph */
export function fbm2(rng, oct = 5) {
  const G = 16, tabs = [];
  for (let o = 0; o < oct; o++) {
    const n = G * G, t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = rng();
    tabs.push({ n, t });
  }
  const val = (tab, n, x, y) => {
    const fx = ((x % 1) + 1) % 1, fy = ((y % 1) + 1) % 1;
    const gx = fx * n, gy = fy * n;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const sx = gx - ix, sy = gy - iy;
    const u = sx * sx * (3 - 2 * sx), v = sy * sy * (3 - 2 * sy);
    const at = (a, b) => tab[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
    const top = lerp(at(ix, iy), at(ix + 1, iy), u);
    const bot = lerp(at(ix, iy + 1), at(ix + 1, iy + 1), u);
    return lerp(top, bot, v);
  };
  return (x, y) => {
    let s = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += amp * val(tabs[o].t, G, x * f, y * f);
      norm += amp;
      amp *= 0.5;
      f *= 2.11;
    }
    return s / norm;
  };
}

/**
 * A tiny synchronous event bus. The app has almost no shared mutable state —
 * a clock, a pointer, a handful of toggles — so this is the whole of the
 * state management. Anything more would be ceremony.
 */
export function emitter() {
  const map = new Map();
  return {
    on(type, fn) {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type).add(fn);
      return () => map.get(type)?.delete(fn);
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set) return;
      for (const fn of set) fn(payload);
    },
  };
}
