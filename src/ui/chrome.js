/* ═══════════════════════════════════════════════════════════════════════════
   Chrome: the reticle, the title/hint text, the boot veil and the fatal pane.

   All of it fades in after a beat. Nothing is shown before the scene has
   something to say, which is what makes the first few seconds read as an
   observation window rather than as a web page.
   ═══════════════════════════════════════════════════════════════════════════ */

export class Chrome {
  constructor() {
    this.reticle = document.getElementById('reticle');
    this.title = document.getElementById('title');
    this.ui = document.getElementById('ui');
    this.mode = document.getElementById('title-mode');
    this.boot = document.getElementById('boot');
    this.fatalEl = document.getElementById('fatal');
    this.debugEl = document.getElementById('debug');
    this.hidden = false;
  }

  /** fade the chrome text in. Does not touch the boot veil: when that comes
   *  off is the caller's decision, because a warmed-up screenshot wants it
   *  gone immediately and a normal load wants it to fade. */
  reveal() {
    this.title.classList.add('visible');
    this.ui.classList.add('visible');
  }

  dismissBoot(immediate = false) {
    if (!this.boot || this.boot.classList.contains('gone')) return;
    this.boot.classList.add('gone');
    if (immediate) this.boot.remove();
    else setTimeout(() => this.boot?.remove(), 1300);
  }

  /** surface runtime errors rather than failing to a black screen */
  fatal(e) {
    const text = (e && (e.stack || e.message)) || e;
    this.fatalEl.hidden = false;
    this.fatalEl.textContent += text + '\n';
    console.error(e);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.title.classList.toggle('visible', !this.hidden);
    this.ui.classList.toggle('visible', !this.hidden);
    return this.hidden;
  }

  moveReticle(x, y) {
    this.reticle.style.opacity = '1';
    this.reticle.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }

  hideReticle() { this.reticle.style.opacity = '0'; }

  /** the reticle's arc steps a fifth of a turn per glyph, like a sector index */
  twist(deg) { this.reticle.style.setProperty('--twist', `${deg}deg`); }

  pulse(k) { this.reticle.style.setProperty('--pulse', k.toFixed(3)); }

  setMode(text) {
    if (this.mode) this.mode.innerHTML = text;
  }

  setDebug(text) {
    if (!this.debugEl) return;
    this.debugEl.hidden = !text;
    this.debugEl.textContent = text || '';
  }
}
