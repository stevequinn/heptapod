/* ═══════════════════════════════════════════════════════════════════════════
   The scene's noise, baked once.

   The fog, the frost and the grain used to evaluate a sin-hash fbm inside
   their fragment shaders:

       fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453)

   The cell coordinates passed to that hash grow into the hundreds for the
   higher octaves, so the argument of the sine lands in the tens of thousands.
   A phone GPU runs fragment floats at mediump — ten bits — where the quantum
   at those magnitudes is tens of radians: whole regions collapse to one
   quantised value, and the boundaries between regions are straight lines
   (the level sets of the dot product), which slide across the pane as the
   fog drifts. That is the faint diagonal line some phones show and desktops
   never do.

   A texture fetch cannot fail that way, and it also saves the per-pixel fbm.
   The sheet is generated from lib/math.js `fbm2`, which wraps at whole
   coordinates, so it tiles seamlessly; its feature size gives the sampling
   scale used by the shaders (1/16 texture units per old fbm unit).

   Channels:  R, G, B  independent fbm fields — the fog shells, the warp field
              that churns them, the wandering light band, the frost and its
              wet patches, the pods' mottling and the veil of mist in front
              of them
              A        white noise — per-cell randomness (the condensation
                       droplets) and the film grain
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { fbm2, mulberry32 } from '../lib/math.js';

/** also the divisor the shaders use when they sample the white-noise channel */
export const NOISE_SIZE = 256;

let TEX = null;

export function noiseTexture() {
  if (TEX) return TEX;

  const rng = mulberry32(0x5eed1234);
  const fr = fbm2(rng, 4);
  const fg = fbm2(rng, 4);
  const fb = fbm2(rng, 3);

  const cv = document.createElement('canvas');
  cv.width = cv.height = NOISE_SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(NOISE_SIZE, NOISE_SIZE);

  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const u = x / NOISE_SIZE, v = y / NOISE_SIZE;
      const o = (y * NOISE_SIZE + x) * 4;
      img.data[o] = (fr(u, v) * 255) | 0;
      img.data[o + 1] = (fg(u, v) * 255) | 0;
      img.data[o + 2] = (fb(u, v) * 255) | 0;
      img.data[o + 3] = (rng() * 255) | 0;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  TEX = tex;
  return tex;
}
