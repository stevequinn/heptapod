/* ═══════════════════════════════════════════════════════════════════════════
   The ink buffer.

   Owns three things: a canvas the dried ink lives on, a low-resolution
   "wet sheen" buffer that evaporates over a second or so, and a per-mark
   snapshot so that fading never re-executes hundreds of vector strokes.

   Ink has an explicit life. Each inscription is drawn progressively, held,
   then faded and dropped, so the pane always returns toward clear instead of
   silting up over a long session.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { INK } from '../config.js';
import { clamp, easeInOutSine } from '../lib/math.js';

const WET_SCALE = INK.wetScale;

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
    this._fadeTick = 0;
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
          // Rebuild a partially drawn mark at the new scale from the ops
          // already executed. Finished marks keep their snapshot.
          this._makeSnap(m);
          for (let i = 0; i < m.idx; i++) this._paintSnap(m, m.glyph.ops[i]);
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

  /** paint one op into a buffer, under the glyph's transform */
  _paint(c2, mark, op, k, wet) {
    c2.save();
    c2.setTransform(
      mark.cs * k, mark.sn * k,
      -mark.sn * k, mark.cs * k,
      mark.cx * k, mark.cy * k,
    );
    op.draw(c2);
    if (wet && op.tip) op.tip(c2);
    c2.restore();
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
   * Re-render the pane. A finished mark blits from its snapshot (a few
   * drawImage calls) rather than re-executing hundreds of vector strokes —
   * re-executing them on every fade tick was the main source of fade jank.
   * A mark still being written has no complete snapshot, so its finished
   * prefix replays from ops, which is bounded by the op count.
   */
  _repaint() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const m of this.marks) {
      if (m.alpha <= 0.002) continue;
      ctx.save();
      // per-mark alpha makes the fade a true dissolve, not a flat wash
      ctx.globalAlpha = m.alpha;
      if (m.finished && m.snap) {
        const s = (m.snapSize * m.R) / m.snapR;
        ctx.drawImage(m.snap, m.cx - s / 2, m.cy - s / 2, s, s);
      } else {
        for (let i = 0; i < m.idx; i++) this._paint(ctx, m, m.glyph.ops[i], 1, false);
      }
      ctx.restore();
    }
    this.tex.needsUpdate = true;
    this.revision++;
  }

  update(dt) {
    this.elapsed += dt;
    const now = this.elapsed;
    this._fadeTick += dt;

    let dirty = false, dirtyFlush = false, repaint = false, removed = false;

    for (const m of this.marks) {
      if (!m.finished) {
        m.t += dt / m.dur;
        const target = easeInOutSine(clamp(m.t, 0, 1)) * m.glyph.total;
        while (m.done < target && m.idx < m.glyph.ops.length) {
          const op = m.glyph.ops[m.idx];
          this._paint(this.ctx, m, op, 1, false);
          // Faint layers (haze, scratches, dust) skip the wet buffer: they
          // contribute nothing to the gloss, and painting them three times
          // over during a click-draw is pure cost.
          if (!op.dryOnly) {
            this._paint(this.wctx, m, op, WET_SCALE, true);
            this._wetLife = 1;
          }
          // The snapshot accumulates alongside the pane, so finishing costs
          // nothing extra — there is no re-render spike at stroke completion.
          if (m.snap) this._paintSnap(m, op);
          dirty = true;
          if (op.head) m.headLocal = op.head;
          m.done += op.w;
          m.idx++;
        }
        if (m.idx >= m.glyph.ops.length && !m.finished) {
          m.finished = true;
          m.finishedAt = now;
          dirtyFlush = true;
        }
      } else {
        const naturalFade = m.finishedAt + m.hold;
        const fadeAt = Math.min(naturalFade, m.retireAt ?? Infinity);
        const duration = m.retireAt == null ? m.fade : 1.35;
        const want = clamp(1 - (now - fadeAt) / duration, 0, 1);
        if (Math.abs(want - m.alpha) > 0.001) { m.alpha = want; repaint = true; }
        if (want <= 0.001) m.dead = true;
      }
    }

    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i].dead) { this.marks.splice(i, 1); removed = true; }
    }

    /* Repaint once, and at most 24 Hz while marks fade. Do not rebuild the
       pane twice a frame, or upload an empty texture indefinitely. */
    if (removed || (repaint && this._fadeTick >= 1 / 24)) {
      this._fadeTick = 0;
      this._repaint();
    } else if (dirty) {
      /* Progressive drawing uploads the ink texture at most 30 Hz: a full
         RGBA upload every frame during a click-draw is a large part of the
         hitch on integrated GPUs. The stroke grows slowly enough that 30 Hz
         is visually identical. Completion always flushes immediately. */
      this._inkTick += dt;
      if (this._inkTick >= 1 / 30 || dirtyFlush) {
        this._inkTick = 0;
        this.tex.needsUpdate = true;
        this.revision++;
      }
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

    /* ---- live write-head, for the glow behind the glass ---------------- */
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
      idx: 0, done: 0, t: 0,
      dur: dur ?? INK.drawSeconds,
      headLocal: null,
      finished: false, finishedAt: 0,
      alpha: 1, dead: false,
      hold: opts.hold ?? INK.hold,
      fade: opts.fade ?? INK.fade,
      born: this.elapsed,
      retireAt: null,
      snap: null, snapCtx: null, snapSize: 0, snapR: R,
    };
    this._makeSnap(m);
    this.marks.push(m);
    this.revision++;
    return m;
  }

  /** the mark most recently added and still visible, for the unwrap view */
  latest() {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      if (this.marks[i].alpha > 0.05) return this.marks[i];
    }
    return null;
  }
}
