/* ═══════════════════════════════════════════════════════════════════════════
   Proof sheet.

   A contact sheet of finished logograms on flat ground, laid out the way
   Wolfram's own figures are: the glyph alone, with no fog, no glass, no
   grade. The scene tells you how it sits in the film; this tells you what the
   generator actually produced.

   Open /?proof — or /?proof=24 for a bigger sheet.
   ═══════════════════════════════════════════════════════════════════════════ */

import { makeRingGlyph } from '../ink/glyph.js';
import { mulberry32, ri } from '../lib/math.js';
import { UNWRAP } from '../config.js';
import { warpContext } from './warp.js';

const INK_BG = '#e8ebec';
const INK_FG = '#12181b';

/**
 * @param {number} count  how many glyphs
 * @param {object} opts
 * @param {number} [opts.seed]
 * @param {'deposit'|'whole'|'procedural'} [opts.mode]
 * @param {boolean} [opts.unwrap]  draw the twelve-section strip under each glyph
 */
export function renderProofSheet(count, { seed = 1, mode = 'deposit', unwrap = false } = {}) {
  document.body.innerHTML = '';
  document.body.style.cssText =
    'background:' + INK_BG + ';overflow:auto;margin:0;padding:28px;cursor:auto';

  const cols = Math.min(count, unwrap ? 4 : 6);
  const cell = 300;
  const rows = Math.ceil(count / cols);
  const stripH = unwrap ? 74 : 0;

  const sheet = document.createElement('div');
  sheet.style.cssText =
    `display:grid;grid-template-columns:repeat(${cols},${cell}px);` +
    `gap:26px ${colGap(cols)}`;

  const rng = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const glyph = makeRingGlyph(ri(rng, 1, 0x7fffffff), { mode });

    const box = document.createElement('div');
    const cv = document.createElement('canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cell, h = cell + stripH;
    cv.width = w * dpr;
    cv.height = h * dpr;
    cv.style.cssText = `width:${w}px;height:${h}px;display:block`;
    box.appendChild(cv);

    const ctx = cv.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = INK_BG;
    ctx.fillRect(0, 0, w, h);

    /* the glyph, ring radius = 1 mapped to cell*0.34 */
    const R = cell * 0.34;
    ctx.save();
    ctx.translate(w / 2, cell / 2);
    ctx.scale(R, R);
    ctx.translate(0, 0);
    for (const op of glyph.ops) op.draw(ctx);
    ctx.restore();

    if (unwrap) {
      drawStrip(ctx, glyph, 0, cell + 8, w, stripH - 16);
    }

    const cap = document.createElement('div');
    cap.textContent = `${glyph.seed} · ${glyph.mode} · r${glyph.rule ?? '—'}`;
    cap.style.cssText =
      `font:9px ui-monospace,monospace;letter-spacing:.08em;color:#7d8a8d;` +
      `text-align:center;padding-top:5px;text-transform:uppercase`;
    box.appendChild(cap);
    sheet.appendChild(box);
  }

  document.body.appendChild(sheet);
}

const colGap = (cols) => (cols > 1 ? '18px' : '0');

/** the twelve-section strip, same layout as the in-app unwrap view */
function drawStrip(ctx, glyph, x, y, w, h) {
  const SECTORS = glyph.sectors.length;
  const gutter = UNWRAP.gutter;
  const colW = (w - w * 0.04) / (SECTORS + (SECTORS - 1) * gutter);
  const rMin = UNWRAP.span[0], rMax = UNWRAP.span[1];
  const unit = h / (rMax - rMin);
  const bottom = y + h;
  const yOf = (r) => bottom - (r - rMin) * unit;

  ctx.save();
  ctx.strokeStyle = 'rgba(18,24,27,0.16)';
  ctx.lineWidth = 0.6;
  for (let s = 0; s < SECTORS; s++) {
    const cx = x + w * 0.02 + s * colW * (1 + gutter);
    ctx.strokeRect(cx, y, colW, h);
    ctx.beginPath();
    ctx.moveTo(cx, yOf(1));
    ctx.lineTo(cx + colW, yOf(1));
    ctx.stroke();
  }
  ctx.restore();

  const half = glyph.sectorAngle / 2;
  for (let s = 0; s < SECTORS; s++) {
    const cx = x + w * 0.02 + s * colW * (1 + gutter);
    const mid = (s + 0.5) * glyph.sectorAngle;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 0.5, y - 0.5, colW + 1, h + 1);
    ctx.clip();
    const warp = warpContext(ctx, {
      midAngle: mid,
      halfAngle: half,
      xRange: [cx, cx + colW],
      rRange: [rMin, rMax],
      yRange: [yOf(rMax), yOf(rMin)],
      unit,
      feather: false,
    });
    for (const op of glyph.ops) op.draw(warp);
    ctx.restore();
  }
}
