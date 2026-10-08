/* ═══════════════════════════════════════════════════════════════════════════
   The ink buffer.

   Owns three things: a canvas the dried ink lives on, a low-resolution
   "wet sheen" buffer that evaporates over a second or so, and a per-mark
   snapshot so that fading never re-executes hundreds of vector strokes.

   Inscription is *materialisation*, not drawing. Earlier versions laid the
   glyph down stroke by stroke, which read as a limb travelling clockwise
   around the circle — a drawing action. The film's logograms condense out of
   the air instead. So a mark is rendered once, in full, into its snapshot;
   what animates is a reveal field baked at add() time from the glyph's
   ignition points, plus a sheet of soft smoke puffs. Each frame the snapshot
   is composited through the growing field and the smoke fades over it, so
   the ink appears where the cloud has reached and nowhere else. There is no
   head, no stroke order, and no direction of travel.

   Ink has an explicit life: materialise, hold, dissolve, drop. The dissolve
   is the materialisation unwound — the reveal field runs backwards, so the
   ink comes apart the way it formed, without the cloud, which belongs only
   to arrival.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { INK } from '../config.js';
import { TAU, clamp, clamp01, easeInOutSine, fbm2, mulberry32, rr, smoothstep } from '../lib/math.js';
import { cloudTile } from './smoke.js';

const WET_SCALE = INK.wetScale;
/** resolution of the reveal field; the mask is smoothed up to the snapshot */
const MASK = 96;
/** reveal repaints are capped to this rate, pane redraw and texture upload */
const ANIM_HZ = 30;

export class InkWriter {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.wet = document.createElement('canvas');
    this.wctx = this.wet.getContext('2d');

    this.tex = new THREE.CanvasTexture(this.canvas);
    this.wtex = new THREE.CanvasTexture(this.wet);
    for (const t of [this.tex, this.wtex]) {
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    }

    this.marks = [];
    this.size = new THREE.Vector2(1, 1);
    this.head = null;
    this.elapsed = 0;
    this._wetLife = 0;
    this._inkTick = 0;
    /** bumped whenever the ink changes, so dependent views can invalidate */
    this.revision = 0;
  }

  get count() { return this.marks.length; }

  resize(w, h) {
    const oldW = this.size.x, oldH = this.size.y;
    this.size.set(w, h);

    for (const [cv, c2, ww, hh] of [
      [this.canvas, this.ctx, w, h],
      [this.wet, this.wctx, Math.ceil(w * WET_SCALE), Math.ceil(h * WET_SCALE)],
    ]) {
      cv.width = Math.max(2, ww | 0);
      cv.height = Math.max(2, hh | 0);
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.clearRect(0, 0, cv.width, cv.height);
    }

    if (oldW > 1 && oldH > 1) {
      const scale = Math.min(w, h) / Math.min(oldW, oldH);
      for (const m of this.marks) {
        m.cx *= w / oldW;
        m.cy *= h / oldH;
        m.R *= scale;
        m.cs = m.R;
        if (!m.finished) {
          /* rebuild the full snapshot and the materialisation at the new
             scale; the reveal field is resolution-independent */
          this._makeSnap(m);
          for (const op of m.glyph.ops) this._paintSnap(m, op);
          this._makeMaterialise(m);
        }
      }
      if (this.marks.length) this._repaint();
    }

    /* Drop the GPU allocation. Three keeps a texture's storage sized from
       first upload and thereafter patches it with texSubImage2D, so growing
       the canvas under a live CanvasTexture asks it to write past the end of
       the texture it already has. */
    this.tex.dispose();
    this.wtex.dispose();
    this.tex.needsUpdate = true;
    this.wtex.needsUpdate = true;
    this.revision++;
  }

  clear() {
    for (const [cv, c2] of [[this.canvas, this.ctx], [this.wet, this.wctx]]) {
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.clearRect(0, 0, cv.width, cv.height);
    }
    this.marks.length = 0;
    this.head = null;
    this._wetLife = 0;
    this.tex.needsUpdate = true;
    this.wtex.needsUpdate = true;
    this.revision++;
  }

  /** paint one op into the mark's own snapshot, in glyph-local coordinates */
  _paintSnap(m, op) {
    const c2 = m.snapCtx;
    c2.save();
    c2.setTransform(m.snapR, 0, 0, m.snapR, m.snapSize / 2, m.snapSize / 2);
    op.draw(c2);
    c2.restore();
  }

  _makeSnap(m) {
    const size = Math.max(8, Math.ceil(m.R * 4.2));
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    m.snap = cv;
    m.snapCtx = cv.getContext('2d');
    m.snapSize = size;
    m.snapR = m.R;
  }

  /**
   * Build the smoke sheet and the reveal field for a mark.
   *
   * The reveal field is a low-resolution canvas of *thresholds*: each pixel
   * records when (0..1 of the inscription) it turns solid, from the distance
   * to the glyph's ignition points plus a little noise. Per frame the field
   * is turned into an alpha mask by comparing it with the current progress,
   * and the snapshot is composited through it — so the ink condenses where
   * the cloud has reached rather than being drawn along any path.
   */
  _makeMaterialise(m) {
    const R = m.R;

    /* smoke: soft radial cores at the ink, drawn once into their own sheet.
       The dense source of the cloud — the rest of the billow comes from the
       ink-in-water layers below. */
    const size = Math.max(24, Math.ceil(R * 3.4));
    const smoke = document.createElement('canvas');
    smoke.width = smoke.height = size;
    const sg = smoke.getContext('2d');
    sg.translate(size / 2, size / 2);
    for (const p of m.glyph.materialise?.puffs ?? []) {
      const x = p.x * R, y = p.y * R, r = Math.max(1, p.r * R);
      const a = p.a * 0.5;
      const grad = sg.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(9,11,13,${a})`);
      grad.addColorStop(0.55, `rgba(9,11,13,${a * 0.45})`);
      grad.addColorStop(1, 'rgba(9,11,13,0)');
      sg.fillStyle = grad;
      sg.beginPath();
      sg.arc(x, y, r, 0, TAU);
      sg.fill();
    }
    m.smoke = smoke;
    m.smokeSize = size;

    /* ink clouds: the shared turbulent sheet, drawn as a couple of soft discs
       so the cloud clings to the glyph instead of fogging the whole pane.
       Each layer takes its own crop of the sheet, enlarged — the same water
       seen closer in — and one is stretched along its own axis, which is what
       turns the round billow into a drifting sheet. Intersecting two copies
       was tried and rejected: multiplying one field by a rotated copy of
       itself leaves speckle, and a cloud of speckle is exactly what real ink
       in water never looks like. The vignette only trims the square corners. */
    const lrng = mulberry32((m.glyph.seed ^ 0x85ebca6b) >>> 0);
    const tile = cloudTile();
    const N = tile.width;
    const layers = [];
    for (let i = 0; i < 2; i++) {
      const L = Math.max(48, Math.ceil(R * rr(lrng, 2.3, 2.9)));
      const zoom = rr(lrng, 1.7, 2.4);
      const src = N / zoom;
      const ox = rr(lrng, 0, N - src);
      const oy = rr(lrng, 0, N - src);
      const sp = document.createElement('canvas');
      sp.width = sp.height = L;
      const g2 = sp.getContext('2d');
      g2.save();
      g2.translate(L / 2, L / 2);
      g2.rotate(rr(lrng, 0, TAU));
      g2.scale(rr(lrng, 1.0, 1.28), rr(lrng, 0.78, 1.0));
      g2.drawImage(tile, ox, oy, src, src, -L / 2, -L / 2, L, L);
      g2.restore();
      g2.globalCompositeOperation = 'destination-in';
      const vg = g2.createRadialGradient(L / 2, L / 2, 0, L / 2, L / 2, L / 2);
      vg.addColorStop(0, 'rgba(0,0,0,1)');
      vg.addColorStop(0.72, 'rgba(0,0,0,0.86)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = vg;
      g2.fillRect(0, 0, L, L);
      layers.push({
        cv: sp,
        base: L,
        rot: rr(lrng, 0, TAU),
        spin: rr(lrng, -0.40, 0.40),
        dx: rr(lrng, -0.16, 0.16),
        dy: rr(lrng, -0.16, 0.02),
        alpha: rr(lrng, 0.36, 0.52),
        grow: rr(lrng, 0.35, 0.60),
      });
    }
    m.clouds = layers;

    const ign = m.glyph.materialise?.ignition ?? [{ x: 1, y: 0 }];
    const th = new Float32Array(MASK * MASK);
    const rng = mulberry32((m.glyph.seed ^ 0x9e3779b9) >>> 0);
    const nz = fbm2(rng, 3);
    for (let j = 0; j < MASK; j++) {
      for (let i = 0; i < MASK; i++) {
        const x = ((i + 0.5) / MASK * 2 - 1) * 1.15;
        const y = ((j + 0.5) / MASK * 2 - 1) * 1.15;
        let d = 9;
        for (const g0 of ign) {
          const dd = Math.hypot(x - g0.x, y - g0.y);
          if (dd < d) d = dd;
        }
        const n = nz((i / MASK) * 2.2, (j / MASK) * 2.2);
        /* cap well below 1, so the field always completes during the
           inscription rather than leaving a ghost of the last few pixels */
        th[j * MASK + i] = Math.min(0.85, clamp01(d / 1.75 * 0.82 + (n - 0.5) * 0.55));
      }
    }
    const mask = document.createElement('canvas');
    mask.width = mask.height = MASK;
    m.maskCv = mask;
    m.maskCtx = mask.getContext('2d');
    m.maskImg = m.maskCtx.createImageData(MASK, MASK);
    m.maskTh = th;

    /* scratch canvas for compositing the snapshot through the mask */
    const sc = document.createElement('canvas');
    sc.width = sc.height = m.snapSize;
    m.scratch = sc;
    m.scratchCtx = sc.getContext('2d');
  }

  /**
   * The inscription cloud: soft puffs at the ignition points, then the
   * drifting discs. `p` is the cloud's own progress — it billows and drifts
   * while the ink condenses — and `smokeA` is how strongly it is present at
   * this moment of the inscription.
   */
  _paintCloud(ctx, m, p, smokeA) {
    if (smokeA <= 0.02) return;
    if (m.smoke) {
      const s = m.smokeSize * (0.85 + p * 0.45);
      ctx.save();
      ctx.globalAlpha = smokeA * 0.55;
      ctx.drawImage(m.smoke, m.cx - s / 2, m.cy - s / 2, s, s);
      ctx.restore();
    }
    for (const L of m.clouds) {
      const s = L.base * (1 + p * L.grow);
      ctx.save();
      ctx.translate(m.cx + L.dx * p * m.R, m.cy + L.dy * p * m.R);
      ctx.rotate(L.rot + L.spin * p);
      ctx.globalAlpha = smokeA * L.alpha;
      ctx.drawImage(L.cv, -s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }

  /** composite the snapshot through the reveal mask and stamp it on the pane */
  _blitMasked(ctx, m) {
    m.maskCtx.putImageData(m.maskImg, 0, 0);

    const sc = m.scratchCtx;
    sc.setTransform(1, 0, 0, 1, 0, 0);
    sc.clearRect(0, 0, m.scratch.width, m.scratch.height);
    sc.drawImage(m.snap, 0, 0);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(m.maskCv, 0, 0, m.scratch.width, m.scratch.height);
    sc.globalCompositeOperation = 'source-over';

    const s = (m.snapSize * m.R) / m.snapR;
    ctx.drawImage(m.scratch, m.cx - s / 2, m.cy - s / 2, s, s);
  }

  /** composite a materialising mark: ink cloud under, partially revealed ink over */
  _paintMaterialising(ctx, m) {
    const p = easeInOutSine(clamp01(m.t));

    /* the cloud fades in over the first quarter, billows up, then thins,
       drifts and turns as the ink condenses; ink in water spreads outward
       and dilutes, so the discs grow while their opacity falls */
    this._paintCloud(ctx, m, p, smoothstep(0, 0.25, p) * Math.pow(1 - p, 0.9));

    /* the ink proper condenses out of the cloud once it is up */
    const rp = clamp01((p - 0.12) / 0.88);
    const data = m.maskImg.data, th = m.maskTh;
    for (let k = 0; k < th.length; k++) {
      const a = smoothstep(th[k], th[k] + 0.20, rp);
      const o = k * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
      data[o + 3] = (a * 255) | 0;
    }
    this._blitMasked(ctx, m);
  }

  /**
   * The reverse inscription. The reveal field runs backwards — a ragged wave
   * from wherever the ink condensed last back toward the ignition points,
   * with the field's own noise kept, so no two patches leave together — and
   * a gentle overall paling rides along, so the last core dims rather than
   * being cut off. No smoke: the cloud belongs to the ink's arrival and does
   * not return for the departure. Slow on purpose — dissolving should feel
   * like weather, not like a switch.
   */
  _paintDissolving(ctx, m) {
    const q = clamp01(m.q);

    /* a pixel with threshold th appeared near rp = th and is gone by
       q = 1 - 0.9*th: the dissolve unwinds the condensation in order */
    const data = m.maskImg.data, th = m.maskTh;
    for (let k = 0; k < th.length; k++) {
      const hi = 1 - th[k] * 0.9;
      const gone = smoothstep(hi - 0.20, hi, q);
      const a = (1 - gone) * (1 - 0.35 * q);
      const o = k * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
      data[o + 3] = (a * 255) | 0;
    }
    this._blitMasked(ctx, m);
  }

  /** fresh ink glistens: stamp the finished glyph into the wet buffer once */
  _stampWet(m) {
    const s = ((m.snapSize * m.R) / m.snapR) * WET_SCALE;
    this.wctx.drawImage(m.snap, m.cx * WET_SCALE - s / 2, m.cy * WET_SCALE - s / 2, s, s);
    this.wtex.needsUpdate = true;
    this._wetLife = 1;
  }

  /**
   * Re-render the pane. A finished mark blits from its snapshot; a mark still
   * materialising composites snapshot+mask+smoke; a dissolving mark runs the
   * same composite backwards; a mark with neither (only possible for one
   * frame) replays from ops.
   */
  _repaint() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const m of this.marks) {
      if (m.alpha <= 0.002) continue;
      ctx.save();
      // per-mark alpha makes forced retires a true dissolve, not a flat wash
      ctx.globalAlpha = m.alpha;
      if (m.dissolving) {
        this._paintDissolving(ctx, m);
      } else if (m.finished && m.snap) {
        const s = (m.snapSize * m.R) / m.snapR;
        ctx.drawImage(m.snap, m.cx - s / 2, m.cy - s / 2, s, s);
      } else if (m.smoke) {
        this._paintMaterialising(ctx, m);
      } else {
        for (const op of m.glyph.ops) op.draw(ctx);
      }
      ctx.restore();
    }
    this.tex.needsUpdate = true;
    this.revision++;
  }

  update(dt) {
    this.elapsed += dt;
    const now = this.elapsed;
    this._inkTick += dt;

    let uploading = false, removed = false, anim = false;

    for (const m of this.marks) {
      if (!m.finished) {
        /* materialise: progress is the reveal, not a stroke position */
        m.t += dt / m.dur;
        if (m.t >= 1) {
          m.t = 1;
          m.finished = true;
          m.finishedAt = now;
          m.headLocal = null;
          this._stampWet(m);
          uploading = true;
        } else {
          anim = true;
        }
      } else if (m.dissolving) {
        /* the reverse inscription: the reveal field unwinds; the cloud does
           not come back — it belongs to arrival */
        m.q += dt / m.dispelDur;
        if (m.q >= 1) { m.q = 1; m.dead = true; }
        anim = true;
      } else {
        const fadeAt = Math.min(m.finishedAt + m.hold, m.retireAt ?? Infinity);
        if (now >= fadeAt) {
          m.dissolving = true;
          m.q = 0;
          m.dispelDur = m.retireAt == null ? m.dispel : Math.min(m.dispel, INK.retire);
          anim = true;
        }
      }
    }

    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i].dead) { this.marks.splice(i, 1); removed = true; }
    }

    /* Repaint once per tick, capped while a mark is animating so a full-canvas
       texture upload does not run at an uncapped frame rate. Removal and
       completion always flush. */
    if (removed || uploading) {
      this._repaint();
    } else if (anim && this._inkTick >= 1 / ANIM_HZ) {
      this._inkTick = 0;
      this._repaint();
    }

    /* ---- wet sheen evaporates fast ----------------------------------- */
    if (this._wetLife > 0) {
      const wc = this.wctx;
      wc.save();
      wc.setTransform(1, 0, 0, 1, 0, 0);
      wc.globalCompositeOperation = 'destination-out';
      wc.fillStyle = `rgba(0,0,0,${clamp(dt * 2.5, 0, 0.7)})`;
      wc.fillRect(0, 0, this.wet.width, this.wet.height);
      wc.restore();
      this._wetLife = Math.max(0, this._wetLife - dt * 1.15);
      this.wtex.needsUpdate = true;
      if (this._wetLife === 0) {
        wc.clearRect(0, 0, this.wet.width, this.wet.height);
        this.wtex.needsUpdate = true;
      }
    }

    /* ---- the ember behind the glass ------------------------------------ */
    const live = this.marks.find((m) => !m.finished && m.headLocal);
    this.head = live
      ? {
          x: live.cx + live.headLocal.x * live.cs,
          y: live.cy + live.headLocal.y * live.cs,
          t: clamp(1 - live.t, 0, 1),
        }
      : null;
  }

  /**
   * Add a glyph. Adding past the cap retires the oldest inscription first —
   * a new mark should not have to wait for a natural fade to make room.
   */
  add(glyph, cx, cy, R, dur, opts = {}) {
    if (this.marks.length >= INK.max) {
      const oldest = this.marks.find((m) => m.finished && m.retireAt == null) || this.marks[0];
      if (oldest) oldest.retireAt = this.elapsed;
      // Under rapid input, do not keep an invisible queue of old glyphs.
      while (this.marks.length > INK.max) {
        this.marks.shift();
        this._repaint();
      }
    }
    const m = {
      glyph, cx, cy, R,
      cs: R, sn: 0,
      idx: glyph.ops.length, done: glyph.total, t: 0,
      dur: dur ?? INK.drawSeconds,
      headLocal: glyph.materialise?.ignition?.[0] ?? null,
      finished: false, finishedAt: 0,
      dissolving: false, q: 0, dispelDur: 0,
      alpha: 1, dead: false,
      hold: opts.hold ?? INK.hold,
      dispel: opts.dispel ?? INK.dispel,
      born: this.elapsed,
      retireAt: null,
      snap: null, snapCtx: null, snapSize: 0, snapR: R,
      smoke: null, smokeSize: 0, clouds: null,
      maskCv: null, maskCtx: null,
      maskImg: null, maskTh: null, scratch: null, scratchCtx: null,
    };
    this._makeSnap(m);
    /* the whole glyph is rendered once: materialisation reveals it, so there
       is no partial state to replay and nothing depends on op order */
    for (const op of glyph.ops) this._paintSnap(m, op);
    this._makeMaterialise(m);
    this.marks.push(m);
    this.revision++;
    return m;
  }

  /** the mark most recently added and still visible, for the unwrap view */
  latest() {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      if (m.alpha > 0.05 && !m.dissolving) return m;
    }
    return null;
  }
}
