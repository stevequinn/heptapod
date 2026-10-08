/* ═══════════════════════════════════════════════════════════════════════════
   The fog volume behind the glass.

   The reference frame is a bright, milky grey-blue — much lighter than a
   moody night grade, and that matters: pushing the fog up is what lets the ink
   read as dark marks on pale glass.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { GLSL_NOISE, QUAD_VERT } from '../lib/glsl.js';

export const FOG_MID = new THREE.Color(0.165, 0.234, 0.250);

export function makeFog(quadGeo) {
  const uniforms = {
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
uniform float uTime, uAspect;
uniform vec2 uCam;
uniform vec4 uRipple, uGlow;
${GLSL_NOISE}

void main(){
  vec2 uv = vUv;
  vec2 asp = vec2(uAspect, 1.0);
  vec2 p = (uv - 0.5) * asp;

  vec3 cDeep = vec3(0.035, 0.063, 0.069);
  vec3 cMid  = vec3(0.165, 0.234, 0.250);
  vec3 cHaze = vec3(0.390, 0.474, 0.488);

  // three parallaxing noise shells, so the haze has depth rather than being a
  // flat wash that the camera merely slides across
  float t = uTime * 0.012;
  float s0 = fbm(p * 0.55 + uCam * 0.055 + vec2(t * 0.70, -t * 0.40), 4);
  float s1 = fbm(p * 0.97 + uCam * 0.155 + vec2(t * 1.20, -t * 0.70) + 13.0, 4);
  float s2 = fbm(p * 1.39 + uCam * 0.255 + vec2(t * 1.70, -t * 1.00) + 27.0, 3);

  // a broad bright band through the middle of the window
  float band = exp(-pow((uv.y - 0.69) * 1.90, 2.0));

  vec3 col = mix(cDeep, cMid, smoothstep(-0.10, 0.55, uv.y));
  col = mix(col, cHaze, band * 0.62 * (0.45 + s1 * 0.85));

  float wisp = s0 * 0.55 + s1 * 0.30 + s2 * 0.15;
  col += (wisp - 0.5) * vec3(0.14, 0.16, 0.16) * (0.35 + band * 0.9);
  col *= 0.55 + 0.75 * smoothstep(0.05, 0.85, wisp + band * 0.35);

  // the dark sill along the bottom of the observation chamber
  col *= 1.0 - 0.53 * (1.0 - smoothstep(0.025, 0.09, uv.y));
  col *= 1.0 - 0.17 * smoothstep(0.995, 1.0, uv.y);

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
