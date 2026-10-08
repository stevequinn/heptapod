/* ═══════════════════════════════════════════════════════════════════════════
   Heptapod silhouettes.

   What is visible in the film is a hanging hand: a broad, indistinct wrist
   disappearing into the fog above, then five long separate drooping digits.
   No radial spokes, no eyes, no body, no spider.

   Two textures are made — one heavily blurred for the creature further back,
   one softer — and both pods share them, so each figure reads as the same
   species.

   The bodies are translucent. The alpha the texture already carries is a
   measure of how much body the light crossed, so it drives absorption: the
   dense core goes darker, the thin flanks keep enough of the light behind
   them to glow. A mottle field breaks the interior the way flesh and gristle
   do, and a screen-space veil of the fog's own noise — sampled at a parallax
   rate between the camera and the creatures — lets mist pass in front of
   them, so they sit *in* the volume rather than being pasted over it.

   The limbs articulate. Each digit swells at a few joint stations along its
   length with a dark crease across every swelling, and the palm carries a
   knuckle row where the digits root — the creases ride in the texture's
   colour channel (the shader reads the body from alpha, the joints from
   colour), where a fold reads as more material in the light's path and so
   darkens toward the core.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { lerp, clamp, mulberry32, rr } from '../lib/math.js';

/**
 * @param {number} seed
 * @param {number} blurPx
 * @returns {THREE.CanvasTexture}
 */
export function makeHeptapodTexture(seed, blurPx) {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const rng = mulberry32(seed);
  g.fillStyle = '#fff';
  g.filter = `blur(${blurPx}px)`;

  /* Wrist and forearm. The sides slant and the shape runs off the top of the
     canvas on purpose: a shape with near-vertical sides and a flat top edge
     reads as a rectangular slab hanging in the fog, which is the single thing
     most likely to make these look like cut paper rather than a limb. */
  g.beginPath();
  g.moveTo(196, -60);
  g.bezierCurveTo(198, 30, 176, 104, 168, 158);
  g.bezierCurveTo(158, 196, 176, 226, 210, 240);
  g.bezierCurveTo(246, 255, 296, 252, 324, 228);
  g.bezierCurveTo(344, 210, 336, 178, 322, 148);
  g.bezierCurveTo(308, 104, 306, 34, 316, -60);
  g.closePath();
  g.fill();

  /* The knuckle row. Five soft shadow arcs sit where the digits root into
     the palm — the one place the hand reads as a hand rather than a bundle
     of ribbons. Drawn dark into the colour channel (the shader reads the
     body from its alpha and the joints from its colour), and blurred with
     everything else, so the row is felt rather than ruled. The stroke is
     near-black and sized against the blur: a thin grey line would smear
     to nothing before it reached the sheet. */
  g.strokeStyle = 'rgb(0, 0, 0)';
  g.lineWidth = Math.max(6, blurPx * 0.6);
  g.lineCap = 'round';
  for (const [rx, ry] of [[190, 196], [206, 221], [240, 230], [276, 230], [311, 205]]) {
    g.beginPath();
    g.moveTo(rx - 9, ry + 4);
    g.quadraticCurveTo(rx, ry + 15, rx + 9, ry + 4);
    g.stroke();
  }

  /**
   * One digit, as a closed tapered ribbon around a quadratic centre-line.
   * Outlined rather than stroked: a stroked path with round caps turns every
   * fingertip into a round dot, which is the giveaway of a drawn hand.
   *
   * The ribbon carries its own knuckles: the width swells at a few joint
   * stations along the digit and a dark crease is drawn across each one,
   * into the colour channel. The swell and the shadow together are what
   * read as articulation — either alone looks like either a stripe or a
   * lump. A small pad just before the tip echoes the ink's tip bulbs, so
   * the creatures and their script share a vocabulary.
   */
  function digit(x0, y0, cx, cy, x1, y1, w0, w1) {
    const joints = [];
    for (let k = 0; k < 3; k++) joints.push(0.27 + k * 0.25 + rr(rng, 0, 0.06));
    const bulge = rr(rng, 0.34, 0.46);
    const pad = rr(rng, 0.16, 0.26);
    const SIG = 0.032;
    const widthAt = (t) => {
      let j = 0;
      for (const jt of joints) j += Math.exp(-Math.pow((t - jt) / SIG, 2));
      j += pad * Math.exp(-Math.pow((t - 0.93) / 0.05, 2));
      return lerp(w0, w1, Math.pow(t, 0.84))
           * (1 + 0.09 * Math.sin(t * 15 + seed * 0.07))
           * (1 + bulge * j);
    };
    const point = (t) => {
      const q = 1 - t;
      return [
        q * q * x0 + 2 * q * t * cx + t * t * x1,
        q * q * y0 + 2 * q * t * cy + t * t * y1,
      ];
    };
    const normal = (t) => {
      const q = 1 - t;
      const dx = 2 * q * (cx - x0) + 2 * t * (x1 - cx);
      const dy = 2 * q * (cy - y0) + 2 * t * (y1 - cy);
      const len = Math.hypot(dx, dy) || 1;
      return [dy / len, dx / len];
    };

    const left = [], right = [];
    // fine enough to carry the joint swellings: two gaussian widths span
    // several samples each, so the outline rounds over every knuckle
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const [x, y] = point(t);
      const [nx, ny] = normal(t);
      const w = widthAt(t);
      left.push([x - nx * w, y - ny * w]);
      right.push([x + nx * w, y + ny * w]);
    }
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const p of left.slice(1)) g.lineTo(p[0], p[1]);
    for (const p of right.reverse()) g.lineTo(p[0], p[1]);
    g.closePath();
    g.fill();

    // the creases: short near-black bands across each swelling, kept inside
    // the ribbon so they never extend the silhouette on their own, and
    // floored against the blur so they survive it as shadow rather than
    // smear to nothing
    g.strokeStyle = 'rgb(0, 0, 0)';
    for (const jt of joints) {
      const [px, py] = point(jt);
      const [nx, ny] = normal(jt);
      const w = widthAt(jt);
      g.lineWidth = Math.max(2.5, w * 0.45, blurPx * 0.55);
      const reach = w * 0.90;
      g.beginPath();
      g.moveTo(px - nx * reach, py - ny * reach);
      g.lineTo(px + nx * reach, py + ny * reach);
      g.stroke();
    }
  }

  const wob = () => rr(rng, -10, 10);
  digit(190, 192, 135 + wob(), 275, 108 + wob(), 462, 19, 3.8);
  digit(205, 217, 178 + wob(), 300, 160 + wob(), 489, 16, 3.5);
  digit(240, 226, 232 + wob(), 337, 235 + wob(), 501, 15, 3.2);
  digit(276, 226, 295 + wob(), 315, 321 + wob(), 482, 15, 3.5);
  digit(313, 201, 364 + wob(), 278, 390 + wob(), 443, 19, 4.0);
  g.filter = 'none';

  /* The wrist runs off the top of the canvas, which means the blur filter
     cuts it and leaves a hard horizontal seam across the shape — visible in
     the scene as a rectangle hanging in the fog. Dissolving the top with a
     gradient mask removes the seam without touching the rest of the limb.

     The gradient has to span the whole canvas: `destination-in` keeps the
     destination only where the source is opaque, anywhere on the canvas, not
     just where the fill was issued. Filling only the top band therefore erases
     everything below it. */
  g.globalCompositeOperation = 'destination-in';
  const fade = g.createLinearGradient(0, 0, 0, 150);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(0.6, 'rgba(0,0,0,0.7)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/* ── billboards ---------------------------------------------------------- */

const POD_VERT = /* glsl */`
varying vec2 vUv;
varying vec2 vScreen;
void main(){
  vUv = uv;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // screen space in the pane's own convention: y = 1 is the top, x = 1 the
  // right — the same axes the fog's shells use
  vScreen = clip.xy / clip.w * 0.5 + 0.5;
  gl_Position = clip;
}
`;

const POD_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
varying vec2 vScreen;
uniform sampler2D tPod;
uniform sampler2D tNoise;
uniform vec3 uFog;
uniform float uDepth;   // 0 = near, 1 = far
uniform float uOpacity;
uniform float uTime;
uniform float uAspect;
uniform vec2 uCam;

void main(){
  vec4 pod = texture2D(tPod, vUv);
  float aRaw = pod.a;
  if (aRaw < 0.004) discard;
  // Atmospheric perspective, heavily. Even the near creature is a soft, low
  // contrast mass behind milky glass, never a hard black cut-out.
  float a = smoothstep(0.02, 0.42, aRaw);
  /* The joints live in the sheet's colour channel: the body is white, the
     knuckle creases and the palm's knuckle row are dark. The sheet uploads
     un-premultiplied, so the mask survives the soft alpha fringes; the
     alpha gate keeps its edges quiet. The joints are applied further down,
     after the body colour is built — see the fold note there. */
  float joint = smoothstep(0.68, 0.30, pod.r) * smoothstep(0.05, 0.30, aRaw);

  const float S = 0.0625;

  /* Translucency. Alpha is optical depth: where the limb is broad the light
     crosses more of it and is absorbed, where it thins out toward the flanks
     the light passes through and scatters out the other side. The old flat
     colour made the same creature read as a paper cut-out however much it
     was blurred; this is what turns the silhouette into a body. */
  float th = smoothstep(0.15, 0.95, a);
  vec3 flank = vec3(0.128, 0.148, 0.160);
  vec3 core  = vec3(0.042, 0.056, 0.066);
  vec3 col = mix(flank, core, th);

  /* The creatures hang under the bright band of the fog, so what little of
     them is visible is lit from above — the upper reaches of a limb carry
     more scattered light than the digits drooping below it. */
  col += vec3(0.026, 0.031, 0.032) * smoothstep(0.30, 0.92, vScreen.y);

  /* and the folds take their shadow after the light. The flat body is
     already at the core tone wherever the alpha is full, so a crease that
     only pulled toward core would vanish against it — a fold is two
     thicknesses of the body overlapping and shadowing itself, and it has
     to read below the core to read at all. The crown of the swelling is
     the opposite case — surface stretched thin over the joint — and the
     blur's shoulder around each crease marks exactly where that thin
     crown sits, so the pair reads as relief even through heavy fog. */
  vec3 fold = core * 0.45;
  col = mix(col, fold, joint * 0.9);
  float crown = smoothstep(0.68, 0.78, pod.r) * (1.0 - smoothstep(0.88, 0.97, pod.r));
  col = mix(col, flank, crown * 0.45);
  a *= 1.0 + joint * 0.16;

  /* Interior mottling: density variations inside the body, a little finer
     than the fog's own shells so the texture belongs to the creature and
     not to the weather. It touches alpha as well as colour — the outline
     breathes with it. */
  float mot = texture2D(tNoise, (vUv * vec2(2.6, 3.4) + vec2(uTime * 0.004, -uTime * 0.003)) * S).r;
  col *= 0.90 + mot * 0.20;
  a *= 0.87 + mot * 0.26;

  col = mix(col, uFog, uDepth * 0.42 + 0.30);

  /* The veil. The pods draw after the fog quad, so nothing yet occludes
     them; sampling the fog's own sheet in screen space, at a parallax
     rate between the camera and the creatures and drifting like the
     shells, puts moving mist between the visitor and the bodies. Where
     the veil is thick the pod's alpha falls and the fog behind shows
     through — which is exactly what mist in front of a shape does. */
  vec2 vp = (vScreen - 0.5) * vec2(uAspect, 1.0);
  float tv = uTime * 0.012;
  float veil = texture2D(tNoise, (vp * 1.05 + uCam * 0.42 + vec2(tv * 0.55, -tv * 0.32)) * S).g;
  float vAmt = (0.09 + uDepth * 0.09) * smoothstep(0.28, 0.92, veil);
  a *= 1.0 - vAmt;
  col = mix(col, uFog, vAmt * 0.45);

  gl_FragColor = vec4(col, a * uOpacity * (1.0 - uDepth * 0.22) * mix(0.44, 0.38, uDepth));
}
`;

/**
 * The two presences: one near the right of the window, one behind the
 * writing on the left. Both drift, and both lean toward wherever the writing
 * is happening.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Color} fogColor
 * @param {{ uTime: object, uCam: object, uAspect: object }} [shared]
 *   uniform entries owned by the fog — the pods live inside the fog's volume,
 *   so they read its clock, its pointer parallax and its aspect ratio rather
 *   than keeping duplicates of them
 */
export function makePods(scene, fogColor, shared = {}) {
  const textures = [
    makeHeptapodTexture(11, 13.0),
    makeHeptapodTexture(37, 7.0),
  ];

  const pods = [];
  function add(z, scale, texIdx, seed, homeY) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        tPod: { value: textures[texIdx] },
        tNoise: { value: null },
        uFog: { value: new THREE.Color().copy(fogColor) },
        uDepth: { value: 0 },
        uOpacity: { value: 1 },
        uTime: shared.uTime ?? { value: 0 },
        uAspect: shared.uAspect ?? { value: 1 },
        uCam: shared.uCam ?? { value: new THREE.Vector2() },
      },
      vertexShader: POD_VERT,
      fragmentShader: POD_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.z = z;
    mesh.scale.setScalar(scale);
    scene.add(mesh);

    const rng = mulberry32(seed);
    const pod = {
      mesh, mat, z, baseScale: scale, seed,
      homeX: 0, homeY,
      amp: new THREE.Vector3(rr(rng, 1.6, 3.4), rr(rng, 1.0, 2.2), 0),
      spd: new THREE.Vector3(rr(rng, 0.035, 0.075), rr(rng, 0.028, 0.060), 0),
      ph: [rr(rng, 0, 9), rr(rng, 0, 9), rr(rng, 0, 9)],
      stretch: rr(rng, 0.05, 0.11),
      response: new THREE.Vector2(),
    };
    pods.push(pod);
    return pod;
  }

  const near = add(-17.0, 14.0, 1, 207, 1.0);
  const far = add(-30.0, 12.5, 0, 419, -0.9);

  /** keep one hand on each side of the pane at every aspect ratio */
  function layout(cam) {
    const fov = Math.tan(THREE.MathUtils.degToRad(cam.fov * 0.5));
    near.homeX = (cam.position.z - near.z) * 2 * fov * cam.aspect * 0.18;
    far.homeX = -(cam.position.z - far.z) * 2 * fov * cam.aspect * 0.30;
  }

  /**
   * @param {number} t      clock
   * @param {number} dt     delta
   * @param {{x:number,y:number}|null} focus  where the writing is, in uv
   * @param {number} engage  0..1, how strongly they react
   */
  function update(t, dt, focus, engage) {
    for (const p of pods) {
      const near_ = p === near;
      /* Two incommensurate sines per axis instead of one: a body floating in
         water is never on a metronome, and the second, slower term is what
         keeps the drift from reading as a pendulum. Pure functions of t, so
         the warm path stays byte-reproducible. */
      const driftX = (Math.sin(t * p.spd.x + p.ph[0]) * 0.30
                    + Math.sin(t * p.spd.x * 0.37 + p.ph[1]) * 0.12) * p.amp.x;
      const driftY = (Math.sin(t * p.spd.y + p.ph[1]) * 0.30
                    + Math.sin(t * p.spd.y * 0.41 + p.ph[2]) * 0.10) * p.amp.y;

      const targetX = focus ? (focus.x - 0.5) * (near_ ? 2.4 : 0.65) : 0;
      const targetY = focus ? (0.5 - focus.y) * (near_ ? 1.4 : 0.4) : 0;
      const response = 1 - Math.exp(-dt * (engage > 0 ? 1.8 : 0.85));
      p.response.x = lerp(p.response.x, targetX, response);
      p.response.y = lerp(p.response.y, targetY, response);

      p.mesh.position.x = p.homeX + driftX + p.response.x;
      p.mesh.position.y = p.homeY + driftY + p.response.y;

      // jellyfish undulation: squash and stretch, with the squeeze trailing
      // the stretch a fraction of a cycle — the wave travels down the body
      const sq = Math.sin(t * 0.42 + p.ph[2]);
      const sq2 = Math.sin(t * 0.42 + p.ph[2] - 0.7);
      p.mesh.scale.set(
        p.baseScale * (1 + sq * p.stretch),
        p.baseScale * (1 - (sq * 0.85 + sq2 * 0.15) * p.stretch),
        1,
      );
      p.mesh.rotation.z = Math.sin(t * 0.19 + p.ph[0]) * 0.09
                        + Math.sin(t * 0.071 + p.ph[1]) * 0.05;

      p.mat.uniforms.uDepth.value = clamp((-p.z - 10) / 26, 0, 1);
      p.mat.uniforms.uOpacity.value = lerp(0.76, 0.64, p.mat.uniforms.uDepth.value);
    }
  }

  return { pods, layout, update, near, far };
}
