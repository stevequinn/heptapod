/* ═══════════════════════════════════════════════════════════════════════════
   A CanvasRenderingContext2D proxy that warps coordinates.

   The unwrap view needs to map every point a glyph op draws from polar
   (angle, radius) into the flat strip layout. Doing that as an image
   transform — crop a wedge, rotate it, paste it — resamples the ink and turns
   a scratchy pen line into mush. Doing it at the point of drawing keeps every
   stroke exactly as crisp as it was in the round view.

   So this intercepts the path-construction calls and maps coordinates on the
   way through. It is deliberately not a full Canvas API: it covers exactly the
   surface the glyph ops use. drawImage cannot be warped by any transform and
   is dropped — the ink haze is the only caller, and it is a soft wash whose
   absence in the analytic view is not missed.

   A Proxy is used rather than a subclass because the ops read and write
   ordinary context state (fillStyle, lineWidth, globalAlpha) and then expect
   the *target* to honour it. Anything that does not forward both ways breaks
   the fill colour silently.
   ═══════════════════════════════════════════════════════════════════════════ */

import { TAU, smoothstep } from '../lib/math.js';

/**
 * @param {CanvasRenderingContext2D} target
 * @param {object} spec
 * @param {number} spec.midAngle   the wedge's centre angle, glyph space
 * @param {number} spec.halfAngle  half the wedge's angular width
 * @param {[number,number]} spec.xRange  destination x, in pixels, for the
 *   wedge's angular edges
 * @param {[number,number]} spec.rRange  the radial span, in ring radii
 * @param {[number,number]} spec.yRange  destination y, in pixels, for rRange
 * @param {boolean} [spec.feather] fade the wedge's edges so seams do not show
 * @param {number} [spec.unit]  pixels per glyph unit. Glyph ops express
 *   lineWidth in glyph units, so the proxy scales it rather than relying on a
 *   canvas transform — a transform here would double-apply, because `map`
 *   already returns device coordinates.
 */
export function warpContext(target, spec) {
  const { midAngle, halfAngle, xRange, rRange, yRange, feather = true, unit = 1 } = spec;
  const [x0, x1] = xRange;
  const xSpan = x1 - x0;
  const rMin = rRange[0], rMax = rRange[1];
  const rSpan = rMax - rMin;
  const yTop = yRange[0], yBot = yRange[1];
  const ySpan = yBot - yTop;

  /** wrapped angular offset from the wedge centre */
  function offsetOf(a) {
    let d = a - midAngle;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }

  /** polar -> strip space, or null when the point falls outside the wedge */
  function map(px, py) {
    const r = Math.hypot(px, py);
    // the centre of the ring is singular in polar coordinates; hold it at the
    // middle of the radial axis so the middle of the circle is not torn apart
    const d = r < 1e-4 ? 0 : offsetOf(Math.atan2(py, px));
    if (d < -halfAngle || d > halfAngle) return null;
    const u = (d + halfAngle) / (2 * halfAngle);
    const v = (r - rMin) / rSpan;
    return [x0 + u * xSpan, yBot - v * ySpan];
  }

  /** how much this wedge is worth at a point; fades the seam */
  function weightAt(px, py) {
    if (!feather) return 1;
    const r = Math.hypot(px, py);
    const d = r < 1e-4 ? 0 : offsetOf(Math.atan2(py, px));
    return smoothstep(halfAngle, halfAngle * 0.84, Math.abs(d));
  }

  /* the pen state we have to track ourselves, because the target's own state
     lives in unwarped space */
  let cur = null;
  let penDown = false;
  /** how much this wedge is worth at the current point; sampled on moveTo
   *  and applied by stroke()/fill() */
  let weight = 1;

  const overrides = {
    moveTo(px, py) {
      const m = map(px, py);
      if (!m) { cur = null; penDown = false; return; }
      cur = m;
      weight = weightAt(px, py);
      target.moveTo(m[0], m[1]);
      penDown = true;
    },

    lineTo(px, py) {
      const m = map(px, py);
      if (!m) { cur = null; penDown = false; return; }
      // if the pen was lifted (the previous point left the wedge), move rather
      // than drawing a chord across the seam
      if (!penDown || !cur) { overrides.moveTo(px, py); return; }
      target.lineTo(m[0], m[1]);
      cur = m;
    },

    quadraticCurveTo(cpx, cpy, px, py) {
      const m = map(px, py), c = map(cpx, cpy);
      if (!m) { cur = null; penDown = false; return; }
      if (!penDown || !cur || !c) { overrides.moveTo(px, py); return; }
      target.quadraticCurveTo(c[0], c[1], m[0], m[1]);
      cur = m;
    },

    bezierCurveTo(bpx, bpy, cpx, cpy, px, py) {
      const m = map(px, py), b = map(bpx, bpy), c = map(cpx, cpy);
      if (!m || !b || !c) { cur = null; penDown = false; return; }
      if (!penDown || !cur) { overrides.moveTo(px, py); return; }
      target.bezierCurveTo(b[0], b[1], c[0], c[1], m[0], m[1]);
      cur = m;
    },

    closePath() { target.closePath(); cur = null; penDown = false; },

    /** circles become polylines through the warp; 24 segments is well under
     *  a pixel at strip scale */
    arc(px, py, radius) {
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * TAU;
        const x = px + Math.cos(a) * radius, y = py + Math.sin(a) * radius;
        if (i === 0) overrides.moveTo(x, y); else overrides.lineTo(x, y);
      }
    },

    ellipse(px, py, rx, ry, rot, a0, a1) {
      for (let i = 0; i <= 28; i++) {
        const t = a0 + (a1 - a0) * (i / 28);
        const x = px + Math.cos(t) * rx * Math.cos(rot) - Math.sin(t) * ry * Math.sin(rot);
        const y = py + Math.cos(t) * rx * Math.sin(rot) + Math.sin(t) * ry * Math.cos(rot);
        if (i === 0) overrides.moveTo(x, y); else overrides.lineTo(x, y);
      }
    },

    rect(px, py, w, h) {
      const pts = [[px, py], [px + w, py], [px + w, py + h], [px, py + h]];
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) overrides.moveTo(pts[0][0], pts[0][1]);
        else overrides.lineTo(pts[i][0], pts[i][1]);
      }
      target.closePath();
      cur = null;
      penDown = false;
    },

    /** transforms are no-ops: the warp *is* the transform, and the strip is
     *  drawn in device space with no glyph transform underneath it */
    setTransform() {}, transform() {}, translate() {}, scale() {}, rotate() {},

    /** warp alpha in, warp alpha out, without a scheduler in between */
    stroke() {
      const prev = target.globalAlpha;
      target.globalAlpha = prev * weight;
      target.stroke();
      target.globalAlpha = prev;
    },
    fill() {
      const prev = target.globalAlpha;
      target.globalAlpha = prev * weight;
      target.fill();
      target.globalAlpha = prev;
    },

    /** the ink haze cannot be warped by any transform; dropped */
    drawImage() {},
  };

  return new Proxy(target, {
    get(obj, prop) {
      if (prop in overrides) return overrides[prop];
      const v = Reflect.get(obj, prop);
      return typeof v === 'function' ? v.bind(obj) : v;
    },
    set(obj, prop, value) {
      // glyph ops set lineWidth in glyph units
      if (prop === 'lineWidth') { obj.lineWidth = value * unit; return true; }
      obj[prop] = value;
      return true;
    },
    has(obj, prop) { return prop in overrides || Reflect.has(obj, prop); },
  });
}
