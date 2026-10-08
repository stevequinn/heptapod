/* ═══════════════════════════════════════════════════════════════════════════
   Room tone.

   One looping track. Browsers will not begin audio without a gesture, so it
   is armed by the visitor's first click, tap or key — and then held back for
   a moment (SOUND.delay), so the room does not start underneath the very
   first thing the visitor does. It pauses whenever the page goes away — a
   minimised window, a locked phone — and returns when the page does. The
   choice is remembered, so someone who turns it off is not asked again by
   the next visit.

   The module owns no UI: it exposes `start` for the first gesture and
   `setEnabled` for the sound button, and main.js keeps the button's label in
   step with `enabled`.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SOUND } from '../config.js';
import trackUrl from '../audio/background-sound.m4a';

/** where the on/off choice is remembered; absence means sound is on */
const PREF = 'arrival.sound';

export function createSound() {
  const el = new Audio(trackUrl);
  el.loop = true;
  el.preload = 'auto';
  el.volume = SOUND.volume;

  let enabled = true;
  try {
    enabled = localStorage.getItem(PREF) !== 'off';
  } catch { /* private mode: sound defaults on, just not remembered */ }

  /** idle → waiting (the first-visit delay) → on. Only ever moves forward. */
  let phase = 'idle';
  let timer = 0;

  const play = () => {
    if (!enabled || document.hidden) return;
    el.play().catch(() => {
      /* Refused — usually a resume the browser wants a fresh gesture for.
         Nothing to do here: `start` retries on the next input, and a retry
         that lands inside a gesture is what the policy wants anyway. */
    });
  };

  // a locked phone or a minimised window takes the room tone with it; both
  // are `visibilitychange` cases
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      el.pause();
    } else if (phase === 'on' && enabled) {
      play();
    }
  });

  return {
    get enabled() { return enabled; },
    get el() { return el; },

    /** call from every pointer or key event; only the first one arms */
    start() {
      if (!enabled) return;
      if (phase === 'idle') {
        phase = 'waiting';
        timer = setTimeout(() => {
          timer = 0;
          phase = 'on';
          play();
        }, SOUND.delay * 1000);
      } else if (phase === 'on' && el.paused) {
        /* still silent — a refused resume, or the delay elapsed while the
           page was away. This event is a gesture, so take it. */
        play();
      }
    },

    setEnabled(on) {
      enabled = on;
      try {
        localStorage.setItem(PREF, on ? 'on' : 'off');
      } catch { /* ignore */ }
      if (on) {
        /* an explicit press, so no first-visit delay */
        phase = 'on';
        play();
      } else {
        el.pause();
      }
    },
  };
}
