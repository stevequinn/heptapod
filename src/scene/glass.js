/* ═══════════════════════════════════════════════════════════════════════════
   The glass composite, and the bloom + grade that finish it.

   This is where the ink stops being a black mask and becomes ink *on glass*:
   the pane warps and frosts what is behind it, the ink both darkens and
   displaces that refracted image, and the wet buffer darkens strokes that are
   still reflective.
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

/** a few taps on a golden-angle spiral: cheap, and no visible structure */
vec3 spiralBlur(sampler2D tex, vec2 uv, float radius){
  vec3 sum = texture2D(tex, uv).rgb;
  const int TAPS = 8;
  for (int i = 0; i < TAPS; i++){
    float fi = float(i) + 0.5;
    float ang = fi * 2.39996323;
    float rad = radius * sqrt(fi / float(TAPS));
    vec2 off = vec2(cos(ang) / uAspect, sin(ang)) * rad;
    sum += texture2D(tex, uv + off).rgb;
  }
  return sum / float(TAPS + 1);
}

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
  float f1 = texture2D(tNoise, (uv * vec2(5.1, 3.0) + vec2(uTime * 0.010, uTime * 0.006)) * S).g;
  float f2 = texture2D(tNoise, (uv * vec2(7.5, 4.4) + vec2(-uTime * 0.014, uTime * 0.009)) * S).b;
  float frost = f1 * 0.68 + f2 * 0.32;
  frost = smoothstep(0.30, 0.86, frost + edge * 0.52);

  float R = 0.0016 + frost * 0.0125 + f2 * 0.0030;

  /* ---- condensation droplets ----------------------------------------- */
  vec2 dp = uv * asp * 34.0;
  vec2 cell = floor(dp), dloc = fract(dp);
  float have = step(0.86, rnd(cell + 19.3));
  vec2 dc = vec2(0.28 + 0.44 * rnd(cell + 1.7), 0.28 + 0.44 * rnd(cell + 8.2));
  float dRad = (0.09 + 0.17 * rnd(cell)) * have;
  float drop = smoothstep(dRad, dRad * 0.80, length(dloc - dc)) * have;
  vec2 dropOff = normalize(dloc - dc + 1e-5) * drop * 0.010;
  dropOff.x /= uAspect;

  /* ---- refracted, frosted background --------------------------------- */
  vec2 bgUV = uv + warp + dropOff * 0.5;
  vec3 col = spiralBlur(tBg, bgUV, R);
  // droplets focus what is behind them a little
  col = mix(col, texture2D(tBg, bgUV + dropOff * 1.6).rgb, drop * 0.45);
  col = col * 0.94 + vec3(0.055, 0.068, 0.074) * (0.35 + frost * 0.5);

  /* ---- room reflections on the glass --------------------------------- */
  // long, soft vertical smears of the overhead lights; broad and very dim,
  // never a distinct blob. No ceiling band: anything pinned to the top edge
  // of the screen puts a lid on the volume.
  float band = smoothstep(0.02, 0.30, uv.y) * (1.0 - smoothstep(0.72, 1.04, uv.y));
  float lamp1 = exp(-pow((uv.x - 0.155) / 0.075, 2.0)) * band;
  float lamp2 = exp(-pow((uv.x - 0.845) / 0.055, 2.0)) * band * 0.7;
  col += vec3(0.030, 0.032, 0.030) * (lamp1 + lamp2);

  /* ---- ink ------------------------------------------------------------ */
  float ia = inkA(uv);
  float ix = inkA(uv + vec2(px.x, 0.0) * 1.5) - inkA(uv - vec2(px.x, 0.0) * 1.5);
  float iy = inkA(uv + vec2(0.0, px.y) * 1.5) - inkA(uv - vec2(0.0, px.y) * 1.5);
  vec2 grad = vec2(ix, iy);

  // ink on glass displaces what is behind it. A single offset fetch is
  // enough: the displacement hides under nearly-opaque ink, so a second full
  // blur kernel per pixel buys nothing visible.
  col = texture2D(tBg, bgUV + grad * 0.020).rgb;

  /* Coverage ramps, deliberately low. The stroke is a thin scratchy line
     whose peak alpha is well under 1 and far lower along most of its length,
     so a high gate here erases most of the ring. */
  float core  = smoothstep(0.30, 0.80, ia);
  float bodyA = smoothstep(0.055, 0.30, ia);
  float edgeN = clamp(length(grad) * 14.0, 0.0, 1.0);

  vec3 inkThin = vec3(0.132, 0.148, 0.155);
  vec3 inkCore = vec3(0.020, 0.024, 0.026);
  vec3 inkCol = mix(inkThin, inkCore, core);

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
