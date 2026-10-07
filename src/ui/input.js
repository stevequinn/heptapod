/* ═══════════════════════════════════════════════════════════════════════════
   Input.

   The pointer position is tracked on the event but eased inside the frame
   loop: pointermove arrives in bursts and can be coalesced, and a cursor that
   lags the real pointer feels broken. So the handlers publish a target and
   the loop chases it.
   ═══════════════════════════════════════════════════════════════════════════ */

import { clamp } from '../lib/math.js';

export function createPointer(el, chrome) {
  const state = {
    /** eased */
    x: 0.5, y: 0.5,
    /** target */
    tx: 0.5, ty: 0.5,
    /** how much the visitor has moved recently, 0..1 engagement */
    moved: 0,
    inside: false,
    width: 1,
    height: 1,
  };

  function measure() {
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
  }

  function move(clientX, clientY) {
    measure();
    state.tx = clientX / state.width;
    state.ty = 1 - clientY / state.height;
    state.moved = Math.min(state.moved + 1, 60);
    state.inside = true;
    chrome.moveReticle(clientX, clientY);
  }

  window.addEventListener('pointermove', (e) => move(e.clientX, e.clientY), { passive: true });
  window.addEventListener('pointerleave', () => {
    state.inside = false;
    chrome.hideReticle();
  });
  // a touch that lifts outside the window never fires pointerleave
  window.addEventListener('blur', () => {
    state.inside = false;
    chrome.hideReticle();
  });

  measure();

  return {
    state,
    move,
    /** returns true if the press was a request for a glyph */
    press(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return false;
      move(e.clientX, e.clientY);
      return true;
    },
    step(dt) {
      const ease = 1 - Math.pow(0.0016, dt);
      state.x += (state.tx - state.x) * ease;
      state.y += (state.ty - state.y) * ease;
    },
    decay(dt) {
      state.moved = Math.max(0, state.moved - dt * 6);
    },
  };
}

/**
 * Keyboard. Returns a map of actions so main.js can bind them without this
 * module knowing what they do.
 */
export function createKeys() {
  const handlers = new Map();
  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.code === 'Space' ? 'space' : e.key.toLowerCase();
    const fn = handlers.get(key);
    if (fn) {
      e.preventDefault();
      fn();
    }
  });
  return {
    on(key, fn) { handlers.set(key, fn); },
  };
}

/** query flags, for deterministic screenshots and tests */
export function queryFlags() {
  const qs = new URLSearchParams(location.search);
  const warm = clamp(parseFloat(qs.get('warm')) || 0, 0, 30);
  const at = qs.get('at');
  let point = null;
  if (at) {
    const [ax, ay] = at.split(',').map(Number);
    if (Number.isFinite(ax) && Number.isFinite(ay)) point = [ax, ay];
  }
  return {
    warm,
    at: point,
    click: qs.has('click'),
    debug: /[?&]debug/.test(location.search),
    unwrap: qs.has('unwrap'),
    /** skip automaton growth, to compare against the procedural deposits */
    noCA: qs.has('noca'),
    /**
     * How the ink deposits are grown. See `main.js` — these are different
     * targets, not preferences, so all three are reachable.
     *   deposit    a disc of ink at each deposit grows outward (film-like)
     *   whole      the whole rasterised logogram seeds one automaton (ca-01)
     *   procedural no automaton
     */
    mode: ['deposit', 'whole', 'procedural'].includes(qs.get('mode'))
      ? qs.get('mode')
      : (qs.has('noca') ? 'procedural' : 'deposit'),
    /** render a contact sheet of bare logograms and skip the scene entirely */
    proof: qs.has('proof')
      ? Math.max(1, Math.min(48, parseInt(qs.get('proof'), 10) || 18))
      : 0,
  };
}
