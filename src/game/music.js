// Looping Christmas background music.
//
//   music.arm()          listen for the player's first tap / key (browsers refuse to play audio before one)
//   music.tryAutoplay()  start straight away if the browser allows it; otherwise the first tap starts it
//   music.setMuted(bool) the sound button: muted = paused, unmuted = playing again from where it stopped
//   music.destroy()      pause + remove every listener (unmount)
//
// It is a plain HTMLAudioElement (separate from the synthesised sound effects), set to loop. The file is only fetched
// once the loading screen is done, so it never competes with the game's own assets. It also pauses while the tab is hidden.
// Nothing is stored: the mute state lives in the app (remembered per device for signed-in players only, as before).
const SRC = '/assets/christmas-bg-music.mp3';
const VOLUME = 0.3;                                  // sits under the sound effects
const GESTURES = ['pointerdown', 'touchend', 'click', 'keydown'];

class Music {
  constructor() { this.el = null; this.muted = false; this.unlocked = false; this.armed = false; this.onGesture = null; this.onVisibility = null; }

  ensure() {
    if (!this.el) {
      const a = new Audio();
      a.src = SRC; a.loop = true; a.preload = 'auto'; a.volume = VOLUME;
      a.setAttribute('aria-hidden', 'true');
      this.el = a;
    }
    return this.el;
  }

  /** Try to play now; resolves quietly if the browser says no (we then wait for a tap). */
  play() {
    if (this.muted || (typeof document !== 'undefined' && document.hidden)) return;
    try {
      const p = this.ensure().play();
      if (p && p.then) p.then(() => { this.unlocked = true; }).catch(() => { /* blocked until the first tap */ });
    } catch (e) { /* ignore */ }
  }

  arm() {
    if (this.armed) return;
    this.armed = true;
    this.onGesture = () => {                          // the first tap/key anywhere: now audio is allowed
      this.unlocked = true;
      this.play();
      GESTURES.forEach((g) => window.removeEventListener(g, this.onGesture, true));
    };
    GESTURES.forEach((g) => window.addEventListener(g, this.onGesture, { capture: true, passive: true }));
    this.onVisibility = () => {
      if (!this.el) return;
      if (document.hidden) this.el.pause(); else if (this.unlocked) this.play();
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  tryAutoplay() { this.play(); }

  setMuted(m) {
    this.muted = !!m;
    if (this.muted) { if (this.el) this.el.pause(); }
    else if (this.unlocked) this.play();              // not unlocked yet: the first tap will start it
  }

  destroy() {
    if (this.onGesture) GESTURES.forEach((g) => window.removeEventListener(g, this.onGesture, true));
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.el) { this.el.pause(); this.el.removeAttribute('src'); this.el.load(); }
    this.el = null; this.unlocked = false; this.armed = false;
  }
}

export const music = new Music();
