/* ═══════════════════════════════════════════════════════════════════════════
   The glass composite, and the bloom + grade that finish it.

   This is where the ink stops being a black mask and becomes ink *on glass*:
   the pane warps and frosts what is behind it, the ink both darkens and
   displaces that refracted image, and the wet buffer darkens strokes that are
   still reflective.

   The pane itself is treated as a physical surface rather than a filter: the
   condensation comes in slow patches instead of an even grain, each bead
   swells and evaporates on its own clock and catches the room light, and the
   lamp reflections slide with the viewpoint, scatter where the frost is
   thick and strengthen toward the grazing edges of the pane.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { QUAD_VERT } from '../lib/glsl.js';

export function makeGlass() {
  const uniforms = {
    tBg: { value: null },
    tInk: { value: null },
    tWet: { value: null },
    tNoise: { value: null },
    uRes: { value: new THREE.Vector2() },
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    uRipple: { value: new THREE.Vector4(0, 0, -10, 0) },
    uHeat: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tBg, tInk, tWet, tNoise;
uniform vec2 uRes, uMouse;
uniform float uTime, uAspect, uHeat;
uniform vec4 uRipple;

/** per-cell randomness from the baked white-noise channel */
float rnd(vec2 p){ return texture2D(tNoise, (p + 0.5) / 32.0).a; }

float inkA(vec2 uv){ return texture2D(tInk, uv).a; }

void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);
  vec2 px = 1.0 / uRes;

  /* ---- old-glass low frequency warp --------------------------------- */
  // baked noise (scene/noise-tex.js): S maps the old procedural fbm's units
  // onto the sheet's features, so scale and drift are unchanged
  const float S = 0.0625;
  float w1 = texture2D(tNoise, (uv * vec2(1.6, 1.1) + vec2(uTime * 0.008, 0.0)) * S).r;
  float w2 = texture2D(tNoise, (uv * vec2(1.3, 1.7) - vec2(0.0, uTime * 0.006)) * S).b;
  vec2 warp = (vec2(w1, w2) - 0.5) * 0.0028;

  /* ---- frost / condensation ------------------------------------------ */
  vec2 edgeD = abs(uv - 0.5) * 2.0;
  // radial, not rectangular: the frost thickens toward the far corners of the
  // glass rather than along the four screen edges, so it never draws a frame
  float edge = smoothstep(0.55, 1.35, length(edgeD));
  // a very low frequency wet-region mask, drifting barely at all:
  // condensation waxes and wanes across a pane in regions — thick here,
  // nearly clear there — rather than as an even grain over the whole surface
  float wet = texture2D(tNoise, (uv * vec2(0.45, 0.85) + vec2(uTime * 0.0016, -uTime * 0.0011)) * S).r;
  float f1 = texture2D(tNoise, (uv * vec2(5.1, 3.0) + vec2(uTime * 0.010, uTime * 0.006)) * S).g;
  float f2 = texture2D(tNoise, (uv * vec2(7.5, 4.4) + vec2(-uTime * 0.014, uTime * 0.009)) * S).b;
  float frost = f1 * 0.68 + f2 * 0.32;
  frost = smoothstep(0.30, 0.86, frost * (0.60 + 0.62 * wet) + edge * 0.52);

  /* ---- condensation droplets ----------------------------------------- */
  vec2 dp = uv * asp * 34.0;
  vec2 cell = floor(dp), dloc = fract(dp);
  float dR0 = rnd(cell);
  // each bead is on its own clock: it swells over the better part of a
  // minute, holds, then evaporates. The whole pane is never static, but no
  // two droplets move together, so it never reads as animation either.
  // "swell" drives the radius *and* the optical weight, so a shrinking bead
  // also refracts less — otherwise the pane kept a full-sized ghost lens
  // where the water had already gone.
  float life = fract(dR0 * 7.31 + uTime * 0.011);
  float swell = smoothstep(0.0, 0.55, life) * (1.0 - smoothstep(0.82, 1.0, life));
  float have = step(0.86, rnd(cell + 19.3));
  vec2 dc = vec2(0.28 + 0.44 * rnd(cell + 1.7), 0.28 + 0.44 * rnd(cell + 8.2));
  float dl = length(dloc - dc);
  // beads grow fatter where the pane is wet
  float dRad = (0.09 + 0.17 * dR0) * have * swell * (0.72 + 0.56 * frost);
  float drop = smoothstep(dRad, dRad * 0.80, dl) * have * smoothstep(0.0, 0.30, swell);
  vec2 dropOff = normalize(dloc - dc + 1e-5) * drop * 0.010;
  dropOff.x /= uAspect;

  /* ---- the ink field, before the composite ---------------------------- */
  /* Its gradient is needed early: the displaced background the ink drags
     with it is one of the composite's background fetches, shared with the
     ink's own coverage mix below. */
  float ia = inkA(uv);
  float ix = inkA(uv + vec2(px.x, 0.0) * 1.5) - inkA(uv - vec2(px.x, 0.0) * 1.5);
  float iy = inkA(uv + vec2(0.0, px.y) * 1.5) - inkA(uv - vec2(0.0, px.y) * 1.5);
  vec2 grad = vec2(ix, iy);

  /* ---- the pane's view: refracted, then frosted by what it adds --------- */
  vec2 bgUV = uv + warp + dropOff * 0.5;
  /* No blur kernel, deliberately. The background sheet is half-resolution,
     which is already softer than any frost radius measured against it — a
     per-pixel spiral (and later a mip-chain pull) changed nothing in the
     frame but its time. The frost reads through what it adds: the
     milkiness below, the beads with their rims and glints, the lamp
     smears — not through what it smears. */
  vec3 col = texture2D(tBg, bgUV).rgb;
  // droplets focus what is behind them a little: the bead magnifies, so it
  // samples the point its lens actually gathers, not the one beside it
  col = mix(col, texture2D(tBg, bgUV + dropOff * 1.6).rgb, drop * 0.45);
  /* the ink's displaced background, fetched once and used again by the ink
     section below: away from ink the gradient is zero and this is bgUV
     itself */
  vec3 under = texture2D(tBg, bgUV + grad * 0.020).rgb;
  // condensation throws a little room light back: a faint milkiness that
  // strengthens where the pane is wet. The floor is low on purpose — a clear
  // stretch of glass should barely lift at all — and the fog's own grade
  // stays the master of the frame.
  col = col * 0.94 + vec3(0.055, 0.068, 0.074) * (0.16 + frost * 0.48);

  /* Droplets are beads, not lenses: a meniscus darkens the rim and a single
     tight highlight sits where the room light catches the crown — up and to
     the left, where the lamps are. Pure arithmetic on values already in
     hand; no further fetches. */
  float rim = smoothstep(dRad * 0.55, dRad * 0.92, dl) * (1.0 - smoothstep(dRad * 0.92, dRad * 1.03, dl));
  col *= 1.0 - rim * 0.16 * drop;
  // the highlight is a fair fraction of the bead — a one-pixel spark reads
  // as sensor noise, a quarter-bead gleam reads as water
  vec2 gc = dloc - (dc + vec2(-0.24, 0.22) * dRad);
  float glint = exp(-dot(gc, gc) / max(dRad * dRad * 0.22, 1e-6)) * drop;
  col += glint * vec3(0.15, 0.17, 0.175) * (1.0 - frost * 0.6);

  /* ---- room reflections on the glass --------------------------------- */
  // long, soft vertical smears of the overhead lights; broad and very dim,
  // never a distinct blob. No ceiling band: anything pinned to the top edge
  // of the screen puts a lid on the volume.
  // They behave like reflections now: the smear slides as the visitor's
  // viewpoint moves, spreads and dims where the frost scatters it, and
  // strengthens toward the edges of the pane where the view is grazing and
  // glass throws back more of the room.
  vec2 vp = uMouse - 0.5;
  float fres = 0.55 + 0.45 * smoothstep(0.70, 1.40, length(edgeD));
  float spread = 1.0 + frost * 1.6;
  float lampBand = smoothstep(0.02, 0.30, uv.y - vp.y * 0.03)
                 * (1.0 - smoothstep(0.72, 1.04, uv.y - vp.y * 0.03));
  float lamp1 = exp(-pow((uv.x - 0.155 - vp.x * 0.055) / (0.075 * spread), 2.0)) * lampBand;
  float lamp2 = exp(-pow((uv.x - 0.845 - vp.x * 0.055) / (0.055 * spread), 2.0)) * lampBand * 0.7;
  col += vec3(0.024, 0.026, 0.024) * (lamp1 + lamp2) * fres * (1.0 - frost * 0.28);

  /* ---- ink ------------------------------------------------------------ */
  /* Coverage ramps, deliberately low. The stroke is a thin scratchy line
     whose peak alpha is well under 1 and far lower along most of its length,
     so a high gate here erases most of the ring. */
  float core  = smoothstep(0.30, 0.80, ia);
  float bodyA = smoothstep(0.055, 0.30, ia);
  float edgeN = clamp(length(grad) * 14.0, 0.0, 1.0);

  vec3 inkThin = vec3(0.132, 0.148, 0.155);
  vec3 inkCore = vec3(0.020, 0.024, 0.026);
  vec3 inkCol = mix(inkThin, inkCore, core);

  // the pane's treatment fades out under the strokes, where the displaced
  // background takes over (see the composite above for where "under" came
  // from and why a bare reassignment would wipe the frost from the pane)
  col = mix(col, under, bodyA);

  // wet ink darkens fresh strokes while they are still reflective
  float waS = smoothstep(0.010, 0.26, texture2D(tWet, uv).a);

  // full weight wherever there is genuine ink, so a thin line still reads dark
  col = mix(col, inkCol, bodyA);
  // no bright fringe: a gloss halo around fresh strokes read as a glow rather
  // than as ink
  col = mix(col, inkCol * 0.62, waS * 0.42);

  /* ---- the ripple a request sends through the glass ------------------- */
  if (uRipple.w > 0.001) {
    float age = uTime - uRipple.z;
    float d = length((uv - uRipple.xy) * asp);
    if (age > 0.0 && age < 3.0) {
      float r = age * 0.34;
      /* confined the same way the fog's ripple is: gone before the ring's
         radius outgrows the short side of the pane, where an arc would read
         as a stray diagonal line across the screen */
      float rMax = max(0.30, min(uAspect, 1.0) * 1.05);
      float edge = 1.0 - smoothstep(0.62, 1.0, r / rMax);
      float ring = exp(-pow((d - r) / 0.030, 2.0)) * exp(-age * 1.3) * edge;
      col += ring * uRipple.w * vec3(0.16, 0.20, 0.215);
      col += ring * uRipple.w * edgeN * 0.10;
    }
  }

  /* ---- the limb behind the glass, where the visitor is ------------- */
  float dm = length((uv - uMouse) * asp);
  col += exp(-pow(dm / 0.070, 2.0)) * (0.022 + uHeat * 0.048) * vec3(0.42, 0.52, 0.56);

  /* ---- distance falloff ------------------------------------------------ */
  /* Round and very soft, where there used to be a rectangular window frame.
     max(x, y) has a crease along every diagonal to a corner, and with the
     frame multiply beneath it the pane read as the inside of a box — the
     faint light lines in the corners. length() is smooth in every direction:
     the fog simply cools toward the edges of the view, and the room has no
     walls. */
  float rv = length(edgeD);
  col *= 1.0 - 0.38 * smoothstep(0.72, 1.55, rv);

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`,
  });

  return { mat, uniforms };
}

export function makeBloom() {
  const bright = new THREE.ShaderMaterial({
    uniforms: { tIn: { value: null }, uTexel: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uTexel;
void main(){
  vec3 s = texture2D(tIn, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture2D(tIn, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture2D(tIn, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture2D(tIn, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  vec3 c = s * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(0.30, 0.95, l), 1.0);
}
`,
  });

  // five-tap gaussian, separable
  const blur = new THREE.ShaderMaterial({
    uniforms: { tIn: { value: null }, uDir: { value: new THREE.Vector2() } },
    vertexShader: QUAD_VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tIn;
uniform vec2 uDir;
void main(){
  vec3 s = texture2D(tIn, vUv).rgb * 0.227027;
  s += (texture2D(tIn, vUv + uDir * 1.3846).rgb + texture2D(tIn, vUv - uDir * 1.3846).rgb) * 0.316216;
  s += (texture2D(tIn, vUv + uDir * 3.2308).rgb + texture2D(tIn, vUv - uDir * 3.2308).rgb) * 0.070270;
  gl_FragColor = vec4(s, 1.0);
}
`,
  });

  return { bright, blur };
}

export function makeFinal() {
  const uniforms = {
    tComp: { value: null },
    tBloom: { value: null },
    tNoise: { value: null },
    uRes: { value: new THREE.Vector2() },
    uTime: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tComp, tBloom, tNoise;
uniform vec2 uRes;
uniform float uTime;
void main(){
  vec2 uv = vUv;
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);

  // radial chromatic aberration
  float ca = 0.00018 + r2 * 0.0010;
  vec3 col;
  col.r = texture2D(tComp, uv + d * ca).r;
  col.g = texture2D(tComp, uv).g;
  col.b = texture2D(tComp, uv - d * ca).b;

  col += texture2D(tBloom, uv).rgb * 0.55;

  // grade: cold slate, lifted blacks
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 0.80);
  col += vec3(0.010, 0.019, 0.026) * (1.0 - smoothstep(0.0, 0.35, l));
  col = pow(max(col, 0.0), vec3(1.06, 1.02, 0.98));
  col = (col - 0.5) * 1.075 + 0.5 + 0.004;

  col *= 1.0 - smoothstep(0.20, 0.86, r2) * 0.72;
  // film grain: the baked white-noise channel, stepped once per frame so it
  // dances rather than slides
  float g = texture2D(tNoise, uv * (uRes / 256.0) + floor(uTime * 60.0) * vec2(97.3, 51.7)).a;
  col += (g - 0.5) * 0.014;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`,
  });

  return { mat, uniforms };
}
