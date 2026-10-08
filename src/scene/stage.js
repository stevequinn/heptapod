/* ═══════════════════════════════════════════════════════════════════════════
   The renderer: one WebGL context, four targets, five passes.

   The scene graph is almost vestigial — it exists only so the heptapod
   billboards can be positioned in a perspective camera. Everything else is a
   fullscreen quad.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { SCENE } from '../config.js';
import { makeFog, FOG_MID } from './fog.js';
import { makePods } from './pods.js';
import { makeGlass, makeBloom, makeFinal } from './glass.js';
import { noiseTexture } from './noise-tex.js';

export class Stage {
  constructor(mount) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // this scene is fog, blur and grain; retina densities cost about twice
    // the shading for no visible gain
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, SCENE.maxPixelRatio));
    this.renderer.setClearColor(0x0a0e10, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.id = 'scene-canvas';
    this.renderer.domElement.setAttribute(
      'aria-label',
      'The observation window. Click or tap to ask the heptapods for an ink glyph.',
    );
    mount.prepend(this.renderer.domElement);

    /* ---- the reusable fullscreen rig --------------------------------- */
    this.quadGeo = new THREE.PlaneGeometry(2, 2);
    this.quadScene = new THREE.Scene();
    this.quadMesh = new THREE.Mesh(this.quadGeo, null);
    this.quadMesh.frustumCulled = false;
    this.quadScene.add(this.quadMesh);
    this.quadCam = new THREE.Camera();

    /* ---- background --------------------------------------------------- */
    this.bgScene = new THREE.Scene();
    this.bgCam = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.bgCam.position.set(0, 0, 8);

    const fog = makeFog(this.quadGeo);
    this.fog = fog;
    this.bgScene.add(fog.mesh);

    this.podField = makePods(this.bgScene, FOG_MID);

    /* ---- passes ------------------------------------------------------- */
    const glass = makeGlass();
    this.glass = glass;
    const bloom = makeBloom();
    this.bloom = bloom;
    const final = makeFinal();
    this.final = final;

    /* one baked noise sheet serves the fog shells, the frost and the grain;
       it replaces the old per-shader noise, which banded on phone-precision
       floats — see scene/noise-tex.js */
    const noise = noiseTexture();
    fog.uniforms.tNoise.value = noise;
    glass.uniforms.tNoise.value = noise;
    final.uniforms.tNoise.value = noise;

    /* ---- targets ------------------------------------------------------ */
    // Byte targets, not half-float: nothing in this chain needs HDR
    // precision, and halving the bytes halves the fullscreen bandwidth.
    const opt = {
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.bgRT = this.compRT = this.bloomA = this.bloomB = null;
    this._opt = opt;

    this.width = 1;
    this.height = 1;
  }

  _makeTargets(w, h) {
    for (const rt of [this.bgRT, this.compRT, this.bloomA, this.bloomB]) rt?.dispose();
    // the background is fog plus heavily blurred silhouettes: render it at
    // half resolution and upscale in the composite. Same look, a quarter of
    // the shading cost.
    this.bgRT = new THREE.WebGLRenderTarget(
      Math.max(2, Math.floor(w * SCENE.bgScale)),
      Math.max(2, Math.floor(h * SCENE.bgScale)), this._opt);
    this.compRT = new THREE.WebGLRenderTarget(w, h, this._opt);
    const bw = Math.max(2, Math.floor(w * SCENE.bloomScale));
    const bh = Math.max(2, Math.floor(h * SCENE.bloomScale));
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, this._opt);
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, this._opt);
  }

  drawQuad(mat, target) {
    this.quadMesh.material = mat;
    this.renderer.setRenderTarget(target || null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  resize(cssW, cssH) {
    this.width = cssW;
    this.height = cssH;
    const dpr = this.renderer.getPixelRatio();
    this.renderer.setSize(cssW, cssH, false);
    const rw = Math.max(2, Math.floor(cssW * dpr));
    const rh = Math.max(2, Math.floor(cssH * dpr));
    this._makeTargets(rw, rh);

    this.bgCam.aspect = cssW / cssH;
    this.bgCam.updateProjectionMatrix();
    this.podField.layout(this.bgCam);

    this.fog.uniforms.uAspect.value = cssW / cssH;
    this.glass.uniforms.uAspect.value = cssW / cssH;
    this.final.uniforms.uRes.value.set(rw, rh);

    return { rw, rh };
  }

  /** the ink buffer's own resolution, derived from the same rw/rh as the
   *  targets it is sampled against — getDrawingBufferSize can disagree with a
   *  resize the browser has not committed yet, which shows up as ellipses */
  inkSize(rw, rh, budget) {
    const k = Math.min(1, Math.sqrt(budget / Math.max(rw * rh, 1)));
    return [Math.max(2, Math.round(rw * k)), Math.max(2, Math.round(rh * k))];
  }

  /**
   * @param {import('../ink/writer.js').InkWriter} ink
   * @param {object} view  { pointer, heat, head }
   */
  render(ink, view) {
    const r = this.renderer;

    r.setRenderTarget(this.bgRT);
    r.render(this.bgScene, this.bgCam);

    this.glass.uniforms.tBg.value = this.bgRT.texture;
    this.glass.uniforms.tInk.value = ink.tex;
    this.glass.uniforms.tWet.value = ink.wtex;
    this.glass.uniforms.uRes.value.set(ink.canvas.width, ink.canvas.height);
    this.glass.uniforms.uTime.value = view.clock;
    this.glass.uniforms.uMouse.value.set(view.pointer.x, 1 - view.pointer.y);
    this.glass.uniforms.uHeat.value = view.heat;
    this.drawQuad(this.glass.mat, this.compRT);

    this.bloom.bright.uniforms.tIn.value = this.compRT.texture;
    this.bloom.bright.uniforms.uTexel.value.set(1 / this.compRT.width, 1 / this.compRT.height);
    this.drawQuad(this.bloom.bright, this.bloomA);

    this.bloom.blur.uniforms.tIn.value = this.bloomA.texture;
    this.bloom.blur.uniforms.uDir.value.set(1 / this.bloomA.width, 0);
    this.drawQuad(this.bloom.blur, this.bloomB);

    this.bloom.blur.uniforms.tIn.value = this.bloomB.texture;
    this.bloom.blur.uniforms.uDir.value.set(0, 1 / this.bloomA.height);
    this.drawQuad(this.bloom.blur, this.bloomA);

    this.final.uniforms.tComp.value = this.compRT.texture;
    this.final.uniforms.tBloom.value = this.bloomA.texture;
    this.final.uniforms.uTime.value = view.clock;
    this.drawQuad(this.final.mat, null);
  }
}
