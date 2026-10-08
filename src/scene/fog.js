/* ═══════════════════════════════════════════════════════════════════════════
   The fog volume behind the glass.

   The reference frame is a bright, milky grey-blue — much lighter than a
   moody night grade, and that matters: pushing the fog up is what lets the ink
   read as dark marks on pale glass.

   The volume is still three parallaxing shells over the same baked sheet,
   but the shells no longer translate: each advects through a shared, slowly
   drifting warp field, so the density folds and churns the way a real gas
   does instead of scrolling like a decal. From that one mechanism the
   believable parts follow — density saturates (thick fog absorbs, thin fog
   transmits), the light band wanders instead of ruling the frame, and the
   whole volume breathes on a slow tide so no two minutes are the same.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { QUAD_VERT } from '../lib/glsl.js';

export const FOG_MID = new THREE.Color(0.165, 0.234, 0.250);

export function makeFog(quadGeo) {
  const uniforms = {
    tNoise: { value: null },
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector2() },
    uAspect: { value: 1 },
    /** x,y = uv; z = start time; w = strength */
    uRipple: { value: new THREE.Vector4(0, 0, -10, 0) },
    /** x,y = uv; z = intensity; w = radius */
    uGlow: { value: new THREE.Vector4(0, 0, 0, 0) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: QUAD_VERT,
    depthTest: false,
    depthWrite: false,
    fragmentShader: /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tNoise;
uniform float uTime, uAspect;
uniform vec2 uCam;
uniform vec4 uRipple, uGlow;

void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp;

  vec3 cDeep = vec3(0.035, 0.063, 0.069);
  vec3 cMid  = vec3(0.165, 0.234, 0.250);
  vec3 cHaze = vec3(0.390, 0.474, 0.488);

  /* ---- the churn ------------------------------------------------------ */
  /* One warp field, sampled from two channels of the baked sheet and an
     order of magnitude slower than the shells it moves, drives all three
     shells. Each shell leans on it by a different amount, so the layers
     shear against each other — the parallax that reads as volume. The
     slight upward bias is convection: the fog lifts off the warmer floor.
     S maps one unit of the old procedural fbm into the baked sheet's
     feature scale — see scene/noise-tex.js for why this is a texture fetch
     and not a shader fbm. */
  const float S = 0.0625;
  float t = uTime * 0.012;
  vec2 wuv = (p * 0.31 + uCam * 0.030 + vec2(t * 0.11, -t * 0.05)) * S;
  vec2 warp = vec2(texture2D(tNoise, wuv).g,
                   texture2D(tNoise, wuv + vec2(0.5, 0.61)).b) - 0.5;
  warp = warp * 0.9 + vec2(0.0, 0.05);

  float s0 = texture2D(tNoise, (p * 0.55 + uCam * 0.055 + warp * 0.42 + vec2(t * 0.70, -t * 0.40)) * S).r;
  float s1 = texture2D(tNoise, (p * 0.97 + uCam * 0.155 + warp * 0.30 + vec2(t * 1.20, -t * 0.70)) * S).g;
  float s2 = texture2D(tNoise, (p * 1.39 + uCam * 0.255 + warp * 0.20 + vec2(t * 1.70, -t * 1.00)) * S).b;

  /* ---- the light band ------------------------------------------------- */
  /* Where the room is bright, exactly, now depends on a very low frequency
     field: the band's height and strength wander a little, so the light is
     *somewhere* in the fog rather than painted along a rule. The bandN
     sample doubles as a broad density pocket — fog thickens under light. */
  float bandN = texture2D(tNoise, (uv * vec2(0.42, 1.35) + vec2(t * 0.05, 0.0)) * S).r;
  float bandY = 0.69 + (bandN - 0.5) * 0.09;
  float band = exp(-pow((uv.y - bandY) * 1.90, 2.0)) * (0.74 + 0.52 * bandN);

  vec3 col = mix(cDeep, cMid, smoothstep(-0.10, 0.55, uv.y));
  col = mix(col, cHaze, band * 0.62 * (0.45 + s1 * 0.85));

  /* ---- scattering ------------------------------------------------------ */
  /* Density, not texture. The weighted shells plus the vertical profile
     (the volume settles: it is thicker near the floor) go through the
     same saturation curve as before, and a transmission term adds haze
     where the fog is thin enough for light to pass *through* — forward
     scattering, which is what makes fog glow around its light instead
     of merely near it. */
  float wisp = s0 * 0.55 + s1 * 0.30 + s2 * 0.15;
  wisp *= 0.92 + 0.18 * (1.0 - uv.y);
  float dense = smoothstep(0.05, 0.85, wisp + band * 0.35);

  col += (wisp - 0.5) * vec3(0.14, 0.16, 0.16) * (0.35 + band * 0.9);
  col += cHaze * band * 0.12 * (1.0 - dense);
  col *= 0.55 + 0.75 * dense;

  /* A slow tide, minutes long, so the room is never twice the same. The
     ceiling of the chamber must stay light — a dark top edge puts a lid
     on the volume — so the tide rides the density, not the depth mix. */
  col *= 1.0 + 0.025 * sin(uTime * 0.047 + bandN * 3.7);

  /* No sill, no lid. The dark band that used to sit on the bottom edge (and
     the thin one at the top) pinned the volume to the screen and made the
     room read as a bounded chamber. The depth mix above is the whole floor
     now: the fog thickens downward without ever meeting an edge. */

  if (uRipple.w > 0.001) {
    float d = length((uv - uRipple.xy) * asp);
    float age = uTime - uRipple.z;
    if (age > 0.0 && age < 3.4) {
      float r = age * 0.34;
      /* The ring must die while it is still a ring. A radius that passes the
         short side of the pane leaves only a chord across the whole screen,
         which reads as a stray diagonal line rather than as water. */
      float rMax = max(0.30, min(uAspect, 1.0) * 1.05);
      float edge = 1.0 - smoothstep(0.62, 1.0, r / rMax);
      float ring = exp(-pow((d - r) / 0.045, 2.0)) * exp(-age * 1.25) * edge;
      col += ring * uRipple.w * vec3(0.30, 0.36, 0.38);
      col += exp(-pow(d / (0.10 + age * 0.30), 2.0)) * uRipple.w * 0.10 * exp(-age * 1.6);
    }
  }

  if (uGlow.z > 0.001) {
    float d = length((uv - uGlow.xy) * asp);
    col += exp(-pow(d / uGlow.w, 2.0)) * uGlow.z * vec3(0.25, 0.30, 0.32);
  }

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`,
  });

  const mesh = new THREE.Mesh(quadGeo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat, uniforms };
}
