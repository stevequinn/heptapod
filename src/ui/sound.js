/* ═══════════════════════════════════════════════════════════════════════════
   Room tone.

   One looping track, started on the visitor's first gesture — browsers will
   not begin audio otherwise — and stoppable from the chrome. The choice is
   remembered, so someone who turns it off is not asked again by the next
   visit.

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

  let started = false;

  const play = () => {
    el.play().catch(() => {
      /* an autoplay policy refusing a gesture-less play is not an error we
         can act on; the next gesture runs start() again */
      started = false;
    });
  };

  return {
    get enabled() { return enabled; },
    get el() { return el; },

    /** call from the first pointer or key event; no-op once running or off */
    start() {
      if (!enabled || started) return;
      started = true;
      play();
    },

    setEnabled(on) {
      enabled = on;
      try {
        localStorage.setItem(PREF, on ? 'on' : 'off');
      } catch { /* ignore */ }
      if (on) {
        started = true;
        play();
      } else {
        el.pause();
      }
    },
  };
}
