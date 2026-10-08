/* ═══════════════════════════════════════════════════════════════════════════
   Shared GLSL.

   The scene's noise no longer lives here. It used to be a sin-hash fbm in
   every fragment shader, which quantised into visible diagonal banding on
   phone-precision floats; it is now a baked texture — see scene/noise-tex.js
   — so all that remains is the fullscreen-quad vertex shader.
   ═══════════════════════════════════════════════════════════════════════════ */

/** vertex shader for every fullscreen pass: no camera, no matrices */
export const QUAD_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
