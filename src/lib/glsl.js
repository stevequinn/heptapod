/* ═══════════════════════════════════════════════════════════════════════════
   Shared GLSL. Value noise + fbm, used by the fog volume, the frost on the
   glass and the final grain so all three sit in the same noise basis.
   ═══════════════════════════════════════════════════════════════════════════ */

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    s += a * vnoise(p); n += a; a *= 0.5; p = m * p;
  }
  return s / n;
}
`;

/** vertex shader for every fullscreen pass: no camera, no matrices */
export const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
