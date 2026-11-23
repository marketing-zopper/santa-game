// Looping Christmas background music — starts the moment the page loads.
//
//   music.begin(muted)   call once on landing. Tries to play AUDIBLY right away. Browsers (Chrome, Edge, Safari, Firefox) refuse
//                        that until the visitor has touched the page, so if it is refused the music starts SILENTLY
//                        (muted autoplay is always allowed) and becomes audible on the first tap / click / key press.
//   music.setMuted(bool) the sound button: muted = paused, unmuted = playing again (that click is itself a user gesture)
//   music.destroy()      pause + remove every listener (unmount)
//
// PLAYER ELEMENT: a plain <audio> element is tried first (it costs nothing). Chrome and Edge reject autoplay on <audio> even when
// muted but allow MUTED autoplay on a <video>, so if the browser refuses, the same MP3 is played through a non-rendered
// (display:none) <video> instead. It is separate from the synthesised sound effects, set to loop, at a low volume, and pauses while
// the tab is hidden. Nothing is stored: the mute state lives in the app (remembered per device for signed-in players only).
const SRC = '/assets/christmas-bg-music.mp3';
const VOLUME = 0.3;                                  // sits under the sound effects
// Events that count as "user activation" across browsers (touch devices activate on touchend / click, not on pointerdown)
const GESTURES = ['pointerup', 'pointerdown', 'touchend', 'click', 'keydown'];

class Music {
  constructor() { this.el = null; this.kind = 'audio'; this.userMuted = false; this.audible = false; this.armed = false; this.onGesture = null; this.onVisibility = null; this.onStray = null; }

  ensure() {
    if (!this.el) {
      const a = document.createElement(this.kind);
      a.loop = true; a.preload = 'auto'; a.volume = VOLUME; a.muted = true;
      a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', ''); a.setAttribute('aria-hidden', 'true'); a.setAttribute('tabindex', '-1');
      if (this.kind === 'video') { a.disablePictureInPicture = true; a.controls = false; }
      a.style.display = 'none';                       // never rendered: no layout / compositing cost
      a.src = SRC;
      document.body.appendChild(a);
      // If the browser pauses it for no good reason (some engines pause a looping element when it wraps round), carry on —
      // unless the player muted it or the tab is hidden, which are the only reasons WE pause.
      this.onStray = () => { if (!this.el || this.userMuted || document.hidden) return; if (this.audible) this.tryAudible(); else this.silent(); };
      a.addEventListener('pause', this.onStray); a.addEventListener('ended', this.onStray);
      this.el = a;
    }
    return this.el;
  }

  /** Try to make the music audible. If the browser says no (no user activation yet), keep it playing silently instead. */
  tryAudible() {
    if (this.userMuted) return;
    const el = this.ensure();
    el.muted = false;
    let p; try { p = el.play(); } catch (e) { p = null; }
    Promise.resolve(p).then(() => {
      if (!el.paused && !el.muted) { this.audible = true; this.disarm(); }       // success: no more listening for taps
      else this.silent();
    }).catch(() => this.silent());
  }

  /** Muted autoplay: the track is already running, it just needs a tap to become audible. */
  silent() {
    if (this.userMuted || !this.el) return;
    this.audible = false;
    const el = this.el;
    el.muted = true;
    let p; try { p = el.play(); } catch (e) { p = null; }
    Promise.resolve(p).catch(() => {
      // Chrome / Edge refuse muted autoplay on a plain <audio> but allow it on a <video>: switch player, once.
      if (this.kind === 'audio' && this.el === el) { this.rebuild('video'); this.silent(); }
    });
  }

  /** Replace the player element (audio → video fallback). */
  rebuild(kind) {
    this.dropElement();
    this.kind = kind;
    this.ensure();
  }

  dropElement() {
    const el = this.el;
    if (!el) return;
    if (this.onStray) { el.removeEventListener('pause', this.onStray); el.removeEventListener('ended', this.onStray); }
    el.pause(); el.removeAttribute('src'); el.load(); el.remove();
    this.el = null;
  }

  arm() {
    if (this.armed) return;
    this.armed = true;
    this.onGesture = () => { if (!this.audible) this.tryAudible(); };           // keeps trying on every tap until it is really audible
    GESTURES.forEach((g) => window.addEventListener(g, this.onGesture, { capture: true, passive: true }));
    this.onVisibility = () => {
      if (!this.el) return;
      if (document.hidden) this.el.pause();
      else if (!this.userMuted) { if (this.audible) this.tryAudible(); else this.silent(); }
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  disarm() {
    if (this.onGesture) GESTURES.forEach((g) => window.removeEventListener(g, this.onGesture, true));
    this.armed = false; this.onGesture = null;
  }

  /** Call once when the page lands. */
  begin(muted = false) {
    this.userMuted = !!muted;
    this.arm();
    if (!this.userMuted) this.tryAudible();                                     // audible if allowed, else silent + unmute on first tap
  }

  setMuted(m) {
    const was = this.userMuted;
    this.userMuted = !!m;
    if (this.userMuted) { if (this.el) this.el.pause(); }
    else if (was && this.el) { this.arm(); this.tryAudible(); }                  // the click that unmutes is a user gesture
  }

  destroy() {
    this.disarm();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
    this.onVisibility = null;
    this.dropElement();
    this.kind = 'audio'; this.audible = false;
  }
}

export const music = new Music();
