/* ═══════════════════════════════════════════════════════════════════════════
   Heptapod — Ink on Glass

   Wiring. Everything with real behaviour lives in its own module:

     config.js         every tunable
     lib/math.js       noise, easing, the event bus
     ca/               Wolfram's cellular automaton, ported
     ink/glyph.js      one logogram, as a list of weighted draw ops
     ink/writer.js     the ink buffer and the life of each inscription
     unwrap/           the twelve-section analytic view
     scene/            WebGL: fog, glass, bloom, grade
     ui/               chrome and input

   This file owns the clock, the pointer, and the decision to write a glyph.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as THREE from 'three';
import { INK, SCENE, UNWRAP } from './config.js';
import { clamp, lerp } from './lib/math.js';
import { makeRingGlyph } from './ink/glyph.js';
import { InkWriter } from './ink/writer.js';
import { UnwrapView } from './unwrap/panel.js';
import { Stage } from './scene/stage.js';
import { Chrome } from './ui/chrome.js';
import { createPointer, createKeys, queryFlags } from './ui/input.js';

const chrome = new Chrome();
window.addEventListener('error', (ev) => chrome.fatal(ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => chrome.fatal(ev.reason));

const flags = queryFlags();

/* The proof sheet replaces the whole app, so it has to come first: it draws
   glyphs with no scene, fog or grade, which is the only way to see what the
   generator actually produced. */
if (flags.proof) {
  const { renderProofSheet } = await import('./unwrap/proof.js');
  renderProofSheet(flags.proof, {
    mode: flags.mode,
    unwrap: flags.unwrap,
  });
} else {
  boot();
}

/* Everything below is the app. It lives inside a function rather than at
   module scope only so the proof sheet can return early. */
function boot() {
const stage = new Stage(document.body);
const ink = new InkWriter();
const unwrap = new UnwrapView(
  document.getElementById('unwrap'),
  document.getElementById('unwrap-labels'),
);
const pointer = createPointer(document.getElementById('scene-canvas'), chrome);

/* ── state ──────────────────────────────────────────────────────────────── */

const app = {
  clock: 0,
  heat: 0,
  seed: 1337,
  /** cycles the visual composition; no translation is implied by this */
  response: 1,
  spawnTimer: 7,
  mode: flags.mode,
  last: performance.now() / 1000,
  frame: 0,
};

/* ── sizing ─────────────────────────────────────────────────────────────── */

function resize() {
  const { rw, rh } = stage.resize(window.innerWidth, window.innerHeight);
  const [iw, ih] = stage.inkSize(rw, rh, INK.budget);
  ink.resize(iw, ih);
  stage.glass.uniforms.uRes.value.set(ink.canvas.width, ink.canvas.height);
  unwrap.resize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio || 1, UNWRAP.dpr));
}
window.addEventListener('resize', resize);
resize();

/* ── writing a glyph ───────────────────────────────────────────────────── */

/**
 * A request produces a complete logogram, not an unexplained splat: the
 * creature responds where you asked, and the oldest inscription starts
 * dissolving if the glass is already full. Ink is translucent and composited
 * in draw order, so clicking an existing glyph adds a second inscription on
 * top of it — nothing is erased first.
 */
function requestGlyph(nx, ny) {
  const R = Math.min(ink.size.x * 0.28, ink.size.y * 0.225);
  const mx = (R * 1.28) / ink.size.x, my = (R * 1.28) / ink.size.y;
  nx = clamp(nx, mx, 1 - mx);
  ny = clamp(ny, my, 1 - my);

  app.seed = (app.seed * 1103515245 + 12345) >>> 0;
  chrome.twist((app.seed % 5) * 72);

  const glyph = makeRingGlyph(app.seed, { mode: app.mode });
  ink.add(glyph, nx * ink.size.x, ny * ink.size.y, R, INK.drawSeconds);
  app.spawnTimer = SCENE.quiet;

  stage.fog.uniforms.uRipple.value.set(nx, 1 - ny, app.clock, 0.7);
  stage.glass.uniforms.uRipple.value.set(nx, 1 - ny, app.clock, 0.7);
  app.heat = 1;

  if (unwrap.on) unwrap.invalidate();
  return glyph;
}

/**
 * The passive scene. One inscription at a time; further glyphs are responses
 * to the visitor, not endless background scribbling.
 */
function spawnGlyph() {
  if (ink.count) return;
  requestGlyph(Math.random() * 0.11 + 0.35, Math.random() * 0.11 + 0.44);
}

/* ── input bindings ────────────────────────────────────────────────────── */

const keys = createKeys();

window.addEventListener('pointerdown', (e) => {
  if (pointer.press(e)) requestGlyph(pointer.state.tx, 1 - pointer.state.ty);
});

keys.on('space', () => {
  requestGlyph(pointer.state.inside ? pointer.state.tx : 0.42,
               pointer.state.inside ? 1 - pointer.state.ty : 0.5);
});
keys.on('c', () => { ink.clear(); app.spawnTimer = 2; unwrap.invalidate(); });
keys.on('h', () => chrome.toggleHidden());
keys.on('u', () => {
  unwrap.set(!unwrap.on);
  chrome.setMode(
    unwrap.on
      ? 'Twelve&nbsp;sections&nbsp;&nbsp;·&nbsp;&nbsp;Unwrapped'
      : 'Heptapod&nbsp;B&nbsp;&nbsp;·&nbsp;&nbsp;Containment',
  );
});
/**
 * Cycle how the ink deposits are grown.
 *
 * These are genuinely different targets, not preferences, which is why all
 * three are reachable rather than one being "the" answer:
 *
 *   deposit    a disc of ink at each deposit grows outward. Localised and
 *              irregular — closest to the film.
 *   whole      the entire rasterised logogram seeds one automaton, as
 *              ca-01.nb does. Self-similar and symmetric, spreading from the
 *              whole circle. Faithful, and visibly not the film.
 *   procedural no automaton at all.
 */
const MODES = ['deposit', 'whole', 'procedural'];
const MODE_LABEL = {
  deposit: 'Deposits&nbsp;·&nbsp;&nbsp;Automaton',
  whole: 'Logogram&nbsp;·&nbsp;&nbsp;Whole&nbsp;Automaton',
  procedural: 'Deposits&nbsp;·&nbsp;&nbsp;Procedural',
};

keys.on('g', () => {
  app.mode = MODES[(MODES.indexOf(app.mode) + 1) % MODES.length];
  unwrap.invalidate();
  chrome.setMode(MODE_LABEL[app.mode]);
});

/* ── the frame ─────────────────────────────────────────────────────────── */

function step(dt, draw = true) {
  app.clock += dt;
  app.frame++;

  pointer.step(dt);
  pointer.decay(dt);

  /* Spawn cadence follows engagement, but stays slow enough that the pane
     never silts up: idle is roughly one ring every six to nine seconds. */
  app.spawnTimer -= dt;
  if (app.spawnTimer <= 0) {
    const busy = Math.min(pointer.state.moved, 60) / 60;
    spawnGlyph();
    const [lo, hi] = busy > 0.15 ? SCENE.busyCadence : SCENE.idleCadence;
    app.spawnTimer = lerp(lo, hi, Math.random());
  }

  ink.update(dt);

  /* --- fog and the creatures ----------------------------------------- */
  stage.fog.uniforms.uTime.value = app.clock;
  stage.fog.uniforms.uCam.value.set(pointer.state.x - 0.5, pointer.state.y - 0.5);

  /* The write-head only glows while the stroke is genuinely in progress.
     Once a glyph is finished there is no head, and the previous frame's glow
     must be allowed to fall away rather than linger as a stray bright dot. */
  const head = ink.head;
  if (head) {
    const hx = head.x / ink.size.x, hy = 1 - head.y / ink.size.y;
    const k = clamp(head.t, 0, 1);
    stage.fog.uniforms.uGlow.value.set(hx, hy, 0.34 * k, 0.050 + 0.018 * k);
  } else {
    const g = stage.fog.uniforms.uGlow.value;
    g.z = lerp(g.z, 0, dt * 4);
    g.w = lerp(g.w, 0.04, dt * 4);
  }

  app.heat = Math.max(0, app.heat - dt * 0.55);

  /* The creatures lean toward wherever the writing is. */
  const focus = head
    ? { x: head.x / ink.size.x, y: 1 - head.y / ink.size.y }
    : (pointer.state.inside ? { x: pointer.state.x, y: 1 - pointer.state.y } : null);
  stage.podField.update(app.clock, dt, focus, head ? 1 : 0);

  stage.bgCam.position.x = (pointer.state.x - 0.5) * 0.5;
  stage.bgCam.position.y = (pointer.state.y - 0.5) * 0.4;
  stage.bgCam.lookAt(0, 0, -30);

  if (flags.debug) report();

  if (!draw) return;

  stage.render(ink, {
    clock: app.clock,
    pointer: { x: pointer.state.x, y: pointer.state.y },
    heat: app.heat,
  });

  unwrap.draw(unwrap.on ? ink.latest() : null, ink.revision);

  chrome.pulse(1 + app.heat * 0.55);
}

function tick() {
  requestAnimationFrame(tick);
  const now = performance.now() / 1000;
  const dt = Math.min(now - app.last, 0.05);
  app.last = now;
  step(dt);
}

/* ── diagnostics ───────────────────────────────────────────────────────── */

let lastReport = 0;
function report() {
  if (app.clock - lastReport < 0.25) return;
  lastReport = app.clock;
  let sum = 0, nz = 0, peak = 0;
  try {
    const px = ink.ctx.getImageData(0, 0, ink.canvas.width, ink.canvas.height).data;
    for (let i = 3; i < px.length; i += 4 * 29) {
      if (px[i] > 8) { nz++; sum += px[i]; }
      if (px[i] > peak) peak = px[i];
    }
  } catch { /* canvas not readable; skip */ }
  const marks = ink.marks
    .map((m) => `${m.idx}/${m.glyph.ops.length} t=${m.t.toFixed(2)} a=${m.alpha.toFixed(2)}`)
    .join('\n         ');
  chrome.setDebug(
    `frame ${app.frame}  clock ${app.clock.toFixed(1)}s\n` +
    `marks ${ink.count} (${INK.max} held, plus any retiring)\n` +
    `  ${marks || '—'}\n` +
    `ink ${ink.canvas.width}x${ink.canvas.height}  css ${stage.width}x${stage.height}\n` +
    `ink coverage ${nz} sampled, peak alpha ${peak}, mean ${nz ? (sum / nz).toFixed(0) : 0}\n` +
    `growth ${app.mode}  ·  rule ${ink.marks[0]?.glyph.rule ?? '—'}  ·  G to cycle`,
  );
}

/* ── boot ──────────────────────────────────────────────────────────────── */

/* Open with one inscription in a fixed composition: left of the near hand,
   nearly half the viewport tall. */
const opening = makeRingGlyph(20240515, { mode: app.mode });
ink.add(opening,
  ink.size.x * 0.39, ink.size.y * 0.49,
  Math.min(ink.size.x * 0.31, ink.size.y * 0.255), 3.1);

if (flags.unwrap) {
  unwrap.set(true);
  chrome.setMode('Twelve&nbsp;sections&nbsp;&nbsp;·&nbsp;&nbsp;Unwrapped');
}
if (flags.noCA) chrome.setMode('Deposits&nbsp;&nbsp;·&nbsp;&nbsp;Procedural');

if (flags.at) {
  const [ax, ay] = flags.at;
  pointer.move(clamp(ax, 0, stage.width), clamp(ay, 0, stage.height));
  pointer.state.x = pointer.state.tx;
  pointer.state.y = pointer.state.ty;
  pointer.state.moved = 40;
}
if (flags.click) requestGlyph(pointer.state.tx, 1 - pointer.state.ty);

stage.renderer.compile(stage.bgScene, stage.bgCam);

/* Deterministic warm-up for screenshots and tests: `?warm=9` fast-forwards
   nine seconds at a fixed timestep and paints once. The boot veil comes off
   immediately rather than fading, so a screenshot taken straight after load is
   the warmed-up frame and not a half-faded one. */
if (flags.warm > 0) {
  for (let i = 0, n = Math.round(flags.warm * 60); i < n; i++) step(1 / 60, false);
  step(0, true);
  chrome.reveal();
  chrome.dismissBoot(true);
  app.last = performance.now() / 1000;
  requestAnimationFrame(tick);
} else {
  requestAnimationFrame(() => {
    chrome.reveal();
    chrome.dismissBoot();
    tick();
  });
}

/* expose a little of the internals, so the scene can be driven from a console
   or a screenshot harness without reaching into module scope */
window.arrival = { app, ink, stage, unwrap, requestGlyph, THREE, makeRingGlyph };
}
