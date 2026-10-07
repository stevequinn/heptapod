/* ═══════════════════════════════════════════════════════════════════════════
   The unwrap view.

   Wolfram's unwrapping-01.nb takes a logogram to polar coordinates —
   {ArcTan@@#, Norm@#} — and lays the result out as a strip: angle across,
   radius up. sectionBreaking-01.nb then cuts that ring into twelve wedges and
   rotates each one flat so the sections can be compared side by side.

   This is the same idea, as a second view of the glyph currently on the
   glass. One wedge per column, each rotated so its bisector points up, so the
   twelve columns line up on the ring's radius instead of each tilting in its
   own direction.

   Two layers. The ink is multiplied over the WebGL scene so it reads as being
   on the same glass; the rules and section numbers are drawn on a second
   canvas above it that blends normally, because `multiply` erases light text
   against a dark background.
   ═══════════════════════════════════════════════════════════════════════════ */

import { UNWRAP } from '../config.js';
import { TAU, clamp } from '../lib/math.js';
import { warpContext } from './warp.js';

/** how each growth mode is named in the caption */
const GROWTH_LABEL = {
  deposit: 'automaton deposits',
  whole: 'whole-logogram automaton',
  procedural: 'procedural deposits',
};

export class UnwrapView {
  constructor(inkCanvas, labelCanvas) {
    this.canvas = inkCanvas;
    this.labels = labelCanvas;
    this.ctx = inkCanvas.getContext('2d');
    this.lctx = labelCanvas.getContext('2d');
    this.on = false;
    this._key = null;
    this._w = 0;
    this._h = 0;
  }

  set(on) {
    if (this.on === on) return;
    this.on = on;
    for (const c of [this.canvas, this.labels]) c.classList.toggle('on', on);
    this.invalidate();
  }

  resize(w, h, dpr) {
    this._w = w;
    this._h = h;
    for (const c of [this.canvas, this.labels]) {
      c.width = Math.max(2, Math.round(w * dpr));
      c.height = Math.max(2, Math.round(h * dpr));
    }
    this.invalidate();
  }

  invalidate() { this._key = null; }

  /**
   * @param {object|null} mark  the InkWriter mark to unwrap
   * @param {number} revision    InkWriter.revision, for cache invalidation
   */
  draw(mark, revision) {
    if (!this.on) return;

    /* Redrawing the strip on every ink revision — which ticks at 30Hz while a
       glyph is being written — cost about a third of the frame rate for a view
       nobody is watching change that fast. The key is quantised instead, so
       the strip re-renders on meaningful change and otherwise holds still. */
    const key = mark
      ? `${mark.glyph.seed}|${mark.glyph.mode}|${mark.idx >> 2}|${Math.round(mark.alpha * 12)}`
      : 'none';
    if (key === this._key) return;
    this._key = key;
    void revision;

    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.lctx.setTransform(1, 0, 0, 1, 0, 0);
    this.lctx.clearRect(0, 0, W, H);
    if (!mark) return;

    const glyph = mark.glyph;
    const SECTORS = glyph.sectors.length;
    const sectorAngle = glyph.sectorAngle;

    /* ---- layout ------------------------------------------------------- */
    const padX = W * 0.05, padY = H * 0.17;
    const gutter = UNWRAP.gutter;
    const colW = (W - padX * 2) / (SECTORS + (SECTORS - 1) * gutter);
    const colH = H - padY * 2;

    const rMin = UNWRAP.span[0], rMax = UNWRAP.span[1];
    // the ring (r = 1) sits centred in the strip's radial span, r grows upward
    const colBottom = padY + colH;
    const unit = colH / (rMax - rMin);
    const yOf = (r) => colBottom - (r - rMin) * unit;

    /* ---- rules, section numbers, angles ------------------------------- */
    const lctx = this.lctx;
    lctx.save();
    lctx.lineWidth = Math.max(1, W * 0.0011);
    lctx.font = `${Math.max(9, Math.round(W * 0.0105))}px ui-monospace, Menlo, monospace`;
    lctx.textAlign = 'center';

    for (let s = 0; s < SECTORS; s++) {
      const x = padX + s * colW * (1 + gutter);
      const mid = (s + 0.5) * sectorAngle;

      lctx.strokeStyle = 'rgba(150,176,184,0.20)';
      lctx.strokeRect(x, padY, colW, colH);

      // the ring radius, straight across, so the columns line up on it
      lctx.strokeStyle = 'rgba(170,196,204,0.40)';
      lctx.beginPath();
      lctx.moveTo(x, yOf(1));
      lctx.lineTo(x + colW, yOf(1));
      lctx.stroke();

      // section number, weighted by that section's share of the ink
      const p = clamp(glyph.sectors[s], 0, 1);
      lctx.fillStyle = `rgba(226,240,244,${(0.22 + 0.55 * p).toFixed(3)})`;
      lctx.fillText(String(s + 1).padStart(2, '0'), x + colW / 2, padY - H * 0.030);

      lctx.fillStyle = 'rgba(196,214,222,0.34)';
      lctx.fillText(`${Math.round((mid / TAU) * 360)}\u00b0`, x + colW / 2, H - padY + H * 0.048);
    }

    lctx.fillStyle = 'rgba(196,214,222,0.30)';
    lctx.textAlign = 'left';
    // above the section numbers, not below them — the bottom of the viewport
    // belongs to the hint line
    lctx.fillText(
      `${glyph.seed}  ·  ${GROWTH_LABEL[glyph.mode] ?? glyph.mode}  ·  twelve sections of ${Math.round(360 / SECTORS)}\u00b0`,
      padX, padY - H * 0.072,
    );
    lctx.restore();

    /* ---- the ink ------------------------------------------------------ */
    const half = sectorAngle / 2;
    for (let s = 0; s < SECTORS; s++) {
      const x = padX + s * colW * (1 + gutter);
      const mid = (s + 0.5) * sectorAngle;

      ctx.save();
      ctx.beginPath();
      ctx.rect(x - 1, padY - 1, colW + 2, colH + 2);
      ctx.clip();

      ctx.globalAlpha = mark.alpha;
      const warp = warpContext(ctx, {
        midAngle: mid,
        halfAngle: half,
        // one column spans exactly one wedge's angular width
        xRange: [x, x + colW],
        rRange: [rMin, rMax],
        yRange: [yOf(rMax), yOf(rMin)],
        unit,
        feather: true,
      });
      for (const op of glyph.ops) op.draw(warp);
      ctx.restore();
    }
  }
}
