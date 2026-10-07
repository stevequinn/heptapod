/* ═══════════════════════════════════════════════════════════════════════════
   The glass composite, and the bloom + grade that finish it.

   This is where the ink stops being a black mask and becomes ink *on glass*:
   the pane warps and frosts what is behind it, the ink both darkens and
   displaces that refracted image, and the wet buffer darkens strokes that are
   still reflective.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLSL_NOISE, QUAD_VERT } from '../lib/glsl.js';

export function makeGlass() {
  const uniforms = {
    tBg: { value: null },
    tInk: { value: null },
    tWet: { value: null },
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
uniform sampler2D tBg, tInk, tWet;
uniform vec2 uRes, uMouse;
uniform float uTime, uAspect, uHeat;
uniform vec4 uRipple;
${GLSL_NOISE}

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
  float w1 = fbm(uv * vec2(1.6, 1.1) + vec2(uTime * 0.008, 0.0), 2);
  float w2 = fbm(uv * vec2(1.3, 1.7) - vec2(0.0, uTime * 0.006), 2);
  vec2 warp = (vec2(w1, w2) - 0.5) * 0.0028;

  /* ---- frost / condensation ------------------------------------------ */
  vec2 edgeD = abs(uv - 0.5) * 2.0;
  float edge = smoothstep(0.30, 1.02, max(edgeD.x, edgeD.y));
  float f1 = fbm(uv * vec2(5.1, 3.0) + vec2(uTime * 0.010, uTime * 0.006), 4);
  float f2 = fbm(uv * vec2(7.5, 4.4) + vec2(-uTime * 0.014, uTime * 0.009), 3);
  float frost = f1 * 0.68 + f2 * 0.32;
  frost = smoothstep(0.30, 0.86, frost + edge * 0.52);

  float R = 0.0016 + frost * 0.0125 + f2 * 0.0030;

  /* ---- condensation droplets ----------------------------------------- */
  vec2 dp = uv * asp * 34.0;
  vec2 cell = floor(dp), dloc = fract(dp);
  float have = step(0.86, hash12(cell + 19.3));
  vec2 dc = vec2(0.28 + 0.44 * hash12(cell + 1.7), 0.28 + 0.44 * hash12(cell + 8.2));
  float dRad = (0.09 + 0.17 * hash12(cell)) * have;
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
  // never a distinct blob
  float band = smoothstep(0.02, 0.30, uv.y) * (1.0 - smoothstep(0.72, 1.04, uv.y));
  float lamp1 = exp(-pow((uv.x - 0.155) / 0.075, 2.0)) * band;
  float lamp2 = exp(-pow((uv.x - 0.845) / 0.055, 2.0)) * band * 0.7;
  float ceil = smoothstep(0.62, 1.0, uv.y) * 0.055;
  col += vec3(0.030, 0.032, 0.030) * (lamp1 + lamp2 + ceil);

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
      float ring = exp(-pow((d - r) / 0.030, 2.0)) * exp(-age * 1.3);
      col += ring * uRipple.w * vec3(0.16, 0.20, 0.215);
      col += ring * uRipple.w * edgeN * 0.10;
    }
  }

  /* ---- the limb behind the glass, where the visitor is ------------- */
  float dm = length((uv - uMouse) * asp);
  col += exp(-pow(dm / 0.070, 2.0)) * (0.022 + uHeat * 0.048) * vec3(0.42, 0.52, 0.56);

  /* ---- window frame falloff ------------------------------------------- */
  float frameDark = smoothstep(0.55, 1.15, max(edgeD.x, edgeD.y * 1.02));
  col *= 1.0 - frameDark * 0.62;
  float inner = smoothstep(1.16, 0.92, max(edgeD.x, edgeD.y));
  col *= 0.55 + 0.45 * inner;

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
uniform sampler2D tComp, tBloom;
uniform vec2 uRes;
uniform float uTime;
${GLSL_NOISE}
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
  col += (hash12(uv * uRes + fract(uTime) * 719.7) - 0.5) * 0.014;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`,
  });

  return { mat, uniforms };
}
