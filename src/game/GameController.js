// Imperative Canvas game controller.
//
// This is the original index.html game script (canvas rendering, input, FX, countdown, pause, attract mode) lifted into
// a class so React can own the screens while the real-time loop stays OUTSIDE React: one requestAnimationFrame loop,
// no per-frame React renders. React is only called back on discrete events (callbacks below).
//
//   const game = new GameController(canvas, { onHud, onBanner, onCount, onScorePop, onPause, onResume, onGameOver });
//   game.begin(seed)        start a round (3-2-1 countdown, then play)
//   game.pause() / game.resume() / game.quit()
//   game.goMenu()           back to the attract-mode demo behind the menus
//   game.setMuted(bool) / game.unlockAudio()
//   game.destroy()          cancel the loop, timers and every listener (called on unmount)
//
// All gameplay rules live in the shared deterministic engine (./engine.js); nothing here changes them.
import { Sim, CFG } from './engine.js';
import { SynthAudio } from './audio.js';
import { BG } from './sprites.js';
import { drawPhone, drawCoal, drawShield, drawSleigh } from './draw.js';

const W = CFG.W, H = CFG.H;
const SENS = 1.25;   // swipe sensitivity (original value)

export class GameController {
  constructor(canvas, callbacks = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks;
    this.audio = new SynthAudio();

    // canvas scaling
    this.dpr = 1; this.cw = 0; this.ch = 0; this.sc = 1; this.ox = 0; this.oy = 0;
    this.backdrop = null;

    // ambient snow
    this.flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 2.2 + 0.6, v: Math.random() * 0.04 + 0.025, w: Math.random() * 6 }));

    // FX
    this.parts = []; this.floaters = []; this.shake = 0; this.bounce = 0; this.tilt = 0; this.gallop = 0; this.lastX = W / 2; this.flash = 0;

    // game state
    this.sim = null; this.state = 'menu'; this.acc = 0; this.lastTs = 0; this.ptsLevel = 0; this.wake = null;
    this.hudScore = -1; this.hudLives = -1; this.rec = null; this.demo = null;
    this.drag = null; this.keyDir = 0;

    // loop bookkeeping
    this.frameLast = 0; this.frameCount = 0; this.dacc = 0; this.raf = 0; this.timers = new Set(); this.destroyed = false;

    this.onResize = () => this.resize();
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keyUp(e);
    this.onVisibility = () => { if (document.hidden) this.pause(); };
    this.onBlur = () => this.pause();
    this.onPointerDown = (e) => this.pointerDown(e);
    this.onPointerMove = (e) => this.pointerMove(e);
    this.onPointerEnd = (e) => { if (this.drag && e.pointerId === this.drag.id) this.drag = null; };
    this.onBgLoad = () => this.resize();

    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerEnd);
    canvas.addEventListener('pointercancel', this.onPointerEnd);
    if (!BG.complete) BG.addEventListener('load', this.onBgLoad, { once: true });
    if (document.fonts) document.fonts.ready.then(() => { if (!this.destroyed) this.buildBackdrop(); });

    this.resize();
    this.newDemo();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ---------- public API ---------- */
  unlockAudio() { return this.audio.unlock(); }
  setMuted(m) { this.audio.setMuted(m); }

  /** Back to the menu: Santa plays by himself behind the screens. */
  goMenu() {
    this.clearTimers(); this.releaseWake();
    this.state = 'menu'; this.sim = null; this.parts = []; this.floaters = []; this.newDemo();
  }

  /** Start a round with the given seed (server-issued for signed-in players, local for guests). */
  begin(seed) {
    this.clearTimers();
    this.sim = new Sim(seed); this.rec = { inputs: [], last: null };
    this.parts = []; this.floaters = []; this.ptsLevel = CFG.phonePts(0); this.shake = 0; this.lastX = this.sim.x; this.hudLives = -1; this.hudScore = -1;
    this.state = 'count'; this.updateHud(true);
    let n = 3;
    const step = () => {
      if (this.destroyed || this.state !== 'count') return;
      if (n > 0) { this.cb.onCount && this.cb.onCount(n); this.audio.count(false); n--; this.later(step, 700); }
      else {
        this.cb.onCount && this.cb.onCount(0); this.audio.count(true);
        this.state = 'play'; this.lastTs = performance.now(); this.acc = 0;
        this.cb.onBanner && this.cb.onBanner({ title: 'Catch!', sub: 'Swipe left and right' });
      }
    };
    step();
    try { navigator.wakeLock && navigator.wakeLock.request('screen').then((w) => { if (this.destroyed) w.release(); else this.wake = w; }).catch(() => {}); } catch (e) { /* ignore */ }
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.cb.onPause && this.cb.onPause();
  }

  resume() {
    if (this.state !== 'pause') return;
    this.state = 'play'; this.lastTs = performance.now(); this.acc = 0;
    this.cb.onResume && this.cb.onResume();
  }

  /** "End Game" from the pause screen. */
  quit() {
    if (!this.sim) return;
    this.sim.lives = 0; this.sim.over = true; this.endGame();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.clearTimers(); this.releaseWake();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cv.removeEventListener('pointerdown', this.onPointerDown);
    this.cv.removeEventListener('pointermove', this.onPointerMove);
    this.cv.removeEventListener('pointerup', this.onPointerEnd);
    this.cv.removeEventListener('pointercancel', this.onPointerEnd);
    BG.removeEventListener('load', this.onBgLoad);
    this.audio.close();
  }

  /* ---------- internals ---------- */
  later(fn, ms) { const id = setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }
  clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }
  releaseWake() { try { this.wake && this.wake.release(); } catch (e) { /* ignore */ } this.wake = null; }

  resize() {
    if (this.destroyed) return;
    const cv = this.cv;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cw = cv.clientWidth; this.ch = cv.clientHeight;
    cv.width = Math.round(this.cw * this.dpr); cv.height = Math.round(this.ch * this.dpr);
    this.sc = Math.min(this.cw / W, this.ch / H); this.ox = (this.cw - W * this.sc) / 2; this.oy = (this.ch - H * this.sc);  // playfield sits on the bottom edge
    this.buildBackdrop();
    document.documentElement.style.setProperty('--scene-top', Math.round(this.oy + 528 * this.sc) + 'px');
    // UI scale for tablets / laptops / big screens (phones stay at 1) and the width of the playfield column the HUD + menu sit in
    const ui = Math.min(this.cw, this.ch) < 600 ? 1 : Math.min(1.6, Math.max(1, Math.min(this.cw / 390, this.ch / 700)));
    document.documentElement.style.setProperty('--ui-zoom', ui.toFixed(3));
    const sceneTop = this.oy + 528 * this.sc;
    document.documentElement.style.setProperty('--menu-zoom', (ui === 1 ? 1 : Math.max(0.85, Math.min(ui, sceneTop / 650))).toFixed(3));   // Game Home must fit above Santa
    document.documentElement.style.setProperty('--stage-w', Math.min(this.cw, Math.max(W * this.sc, 400 * ui)).toFixed(1) + 'px');
  }

  buildBackdrop() {
    const { cv, cw, ch, dpr, sc, oy } = this;
    const backdrop = document.createElement('canvas'); backdrop.width = cv.width; backdrop.height = cv.height;
    const b = backdrop.getContext('2d'); b.scale(dpr, dpr);
    b.fillStyle = '#07164A'; b.fillRect(0, 0, cw, ch);
    if (BG.complete && BG.naturalWidth) {
      // cover the screen, pinned to the bottom so the snow line sits under Santa's boots
      const k = Math.max(cw / BG.naturalWidth, (oy + 742 * sc) / BG.naturalHeight), dw = BG.naturalWidth * k, dh = BG.naturalHeight * k;
      b.drawImage(BG, (cw - dw) / 2, Math.min(0, oy + 742 * sc - dh), dw, dh);
      if (oy + 742 * sc < ch) { b.fillStyle = '#fff'; b.fillRect(0, oy + 742 * sc - 1, cw, ch); }
    }
    this.backdrop = backdrop;
  }

  /* attract mode: Santa plays by himself behind the menu */
  newDemo() { this.demo = new Sim((Math.random() * 1e9) >>> 0); this.demo.lives = 1e6; }
  demoStep() {
    const demo = this.demo, c = demo.c;
    const goods = demo.items.filter((i) => i.type !== 'coal' && i.y < c.CATCH_Y).map((i) => ({ i, tau: (c.CATCH_Y - i.y) / i.vy })).sort((a, b) => a.tau - b.tau);
    let pos = demo.x, pt = 0, tgt = null;
    for (const g of goods) if (Math.abs(g.i.x - pos) <= c.SLEIGH_SPEED * 0.7 * (g.tau - pt) + 20) { if (tgt == null) tgt = g.i.x; pos = g.i.x; pt = g.tau; }
    if (tgt != null) demo.setTarget(tgt + Math.sin(demo.t * 2) * 10);
    demo.step();
    for (const ev of demo.events) {
      if (ev.e === 'catch') { this.bounce = 6; this.burst(ev.it.x, c.CATCH_Y, ['#fff', '#00B5EA', '#FBEB3C'], 8, 150); }
      else if (ev.e === 'miss') this.shards(ev.it.x, c.GROUND_Y - 6);
    }
    demo.events.length = 0;
    if (demo.t > 24) { demo.t = 0; demo.tick = 0; }   // loop the easy opening forever
  }

  updateHud(force) {
    const s = this.sim; if (!s) return;
    if (force || s.score !== this.hudScore || s.lives !== this.hudLives) {
      this.hudScore = s.score; this.hudLives = s.lives;
      this.cb.onHud && this.cb.onHud({ score: s.score, lives: s.lives });
    }
  }

  endGame() {
    if (this.state === 'over') return;
    this.state = 'over'; this.audio.over(); this.releaseWake();
    const s = this.sim;
    this.cb.onGameOver && this.cb.onGameOver({ score: s.score, caught: s.caught, t: s.t, tick: s.tick, inputs: this.rec.inputs });
  }

  /* ---------- FX ---------- */
  burst(x, y, colors, n, spd) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = spd * (0.4 + Math.random()); this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - spd * 0.5, life: 0.7 + Math.random() * 0.5, t: 0, c: colors[i % colors.length], s: 2 + Math.random() * 4, sh: Math.random() < 0.5 }); } }
  shards(x, y) { for (let i = 0; i < 14; i++) { const a = -Math.PI * Math.random(), v = 120 + Math.random() * 220; this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, t: 0, c: i % 3 ? '#9FC2FF' : '#2C2F4A', s: 3 + Math.random() * 5, sh: true, g: 900 }); } }
  floatText(x, y, txt, col, size) { this.floaters.push({ x, y, txt, col, size: size || 22, t: 0 }); }
  buzz(ms) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  /** Turn engine events into effects (same effects, sounds and vibration as the original). */
  handleEvents() {
    const sim = this.sim, au = this.audio;
    for (const ev of sim.events) {
      const it = ev.it;
      if (ev.e === 'catch') {
        this.bounce = 7; const gold = it.type === 'gold';
        this.burst(it.x, CFG.CATCH_Y, gold ? ['#FBEB3C', '#fff', '#FFB067'] : ['#fff', '#00B5EA', '#FBEB3C'], gold ? 22 : 10, gold ? 260 : 170);
        this.floatText(it.x, CFG.CATCH_Y - 30, '+' + ev.p, gold ? '#FBEB3C' : '#fff', gold ? 30 : 22);
        gold ? au.gold() : au.catch(Math.floor(sim.t / 10));
        this.cb.onScorePop && this.cb.onScorePop();
      } else if (ev.e === 'miss') {
        this.shards(it.x, CFG.GROUND_Y - 6); this.shake = 12; this.flash = 0.35; au.miss(); this.buzz(120);
        this.floatText(it.x, CFG.GROUND_Y - 40, 'CRACK!', '#FF5A6E', 28);
      } else if (ev.e === 'coal') {
        this.burst(it.x, CFG.CATCH_Y, ['#2A2A33', '#555', '#FF7A2E'], 16, 160); this.shake = 10; this.flash = 0.3; au.coal(); this.buzz([60, 40, 60]);
        this.floatText(it.x, CFG.CATCH_Y - 34, 'Coal! -1 life', '#FF5A6E', 22);
      } else if (ev.e === 'shield') {
        this.burst(it.x, CFG.CATCH_Y, ['#00B5EA', '#fff', '#5AD6FA'], 24, 220); au.shield(); this.buzz(30);
        this.floatText(it.x, CFG.CATCH_Y - 34, '+1 life', '#5AD6FA', 26);
      } else if (ev.e === 'over') this.endGame();
    }
    sim.events.length = 0;
    const p = CFG.phonePts(sim.t);
    if (p !== this.ptsLevel && this.state === 'play') { this.ptsLevel = p; if (p % 4 === 2) this.cb.onBanner && this.cb.onBanner({ title: 'Faster!', sub: `${p} points per phone` }); }
  }

  /* ---------- Input: relative swipe anywhere on screen ---------- */
  pointerDown(e) {
    if (this.state !== 'play' && this.state !== 'count') return;
    this.drag = { id: e.pointerId, x: e.clientX };
    try { this.cv.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }
  pointerMove(e) {
    if (!this.drag || e.pointerId !== this.drag.id || !this.sim) return;
    const dx = (e.clientX - this.drag.x) / this.sc * SENS; this.drag.x = e.clientX;
    this.sim.setTarget(this.sim.target + dx);
  }
  keyDown(e) {
    if (e.key === 'ArrowLeft' || e.key === 'a') this.keyDir = -1; else if (e.key === 'ArrowRight' || e.key === 'd') this.keyDir = 1;
    else if (e.key === 'Escape' || e.key === 'p') { if (this.state === 'play') this.pause(); else if (this.state === 'pause') this.resume(); }
  }
  keyUp(e) {
    if ((e.key === 'ArrowLeft' || e.key === 'a') && this.keyDir < 0) this.keyDir = 0;
    if ((e.key === 'ArrowRight' || e.key === 'd') && this.keyDir > 0) this.keyDir = 0;
  }

  /* ---------- Main loop ---------- */
  frame = (ts) => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.frame);
    this.frameCount++;
    const realDt = Math.min(0.05, (ts - (this.frameLast || ts)) / 1000); this.frameLast = ts;
    const sim = this.sim;
    if (this.state === 'play' && sim) {
      this.acc += Math.min(0.1, (ts - this.lastTs) / 1000); this.lastTs = ts;
      if (this.keyDir) sim.setTarget(sim.x + this.keyDir * 60);
      while (this.acc >= 1 / 60 && !sim.over) {
        sim.target = Math.round(sim.target * 4) / 4;                       // recorded moves let the server re-check the score
        if (sim.target !== this.rec.last) { this.rec.inputs.push(sim.tick + 1, sim.target); this.rec.last = sim.target; }
        sim.step(); this.acc -= 1 / 60;
      }
      this.handleEvents(); this.updateHud();
    }
    if (this.state === 'menu' && this.demo) { this.dacc += realDt; while (this.dacc >= 1 / 60) { this.demoStep(); this.dacc -= 1 / 60; } }
    this.render(realDt, ts / 1000);
  };

  render(dt, T) {
    const { ctx, cv, dpr, cw, ch, sc, ox, oy } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0);
    // ambient snow (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (const f of this.flakes) { f.y += f.v * dt; if (f.y > 1) { f.y = -0.02; f.x = Math.random(); } ctx.beginPath(); ctx.arc((f.x + Math.sin(T + f.w) * 0.01) * cw, f.y * ch, f.r, 0, 7); ctx.fill(); }

    // world space
    let sx = 0, sy = 0; if (this.shake > 0) { sx = (Math.random() * 2 - 1) * this.shake; sy = (Math.random() * 2 - 1) * this.shake; this.shake = Math.max(0, this.shake - 60 * dt); }
    ctx.setTransform(sc * dpr, 0, 0, sc * dpr, (ox + sx * sc) * dpr, (oy + sy * sc) * dpr);

    const S = this.state === 'menu' ? this.demo : this.sim;
    const x = S ? S.x : W / 2;
    const vel = (x - this.lastX) / Math.max(dt, 1 / 120); this.lastX = x;
    this.tilt += ((Math.max(-1, Math.min(1, vel / 480)) * 0.08) - this.tilt) * Math.min(1, dt * 10);
    this.gallop += ((Math.abs(vel) > 40 ? 1 : 0) - this.gallop) * Math.min(1, dt * 6);
    this.bounce = Math.max(0, this.bounce - 40 * dt);

    // shadow + sleigh
    ctx.fillStyle = 'rgba(29,30,63,.22)'; ctx.beginPath(); ctx.ellipse(x + 30, 699, 86, 5, 0, 0, 7); ctx.fill();
    ctx.save(); ctx.translate(x, 0); drawSleigh(ctx, this.bounce, T, this.gallop); ctx.restore();

    // items
    if (S) for (const it of S.items) {
      ctx.save(); ctx.translate(it.x, it.y);
      if (it.type === 'phone' || it.type === 'gold') { ctx.rotate(Math.sin(T * 3 + it.id) * 0.25 + it.spin); drawPhone(ctx, it.kind, it.type === 'gold', T); }
      else if (it.type === 'coal') { ctx.rotate(T * 2 + it.spin); drawCoal(ctx); }
      else drawShield(ctx, T);
      ctx.restore();
    }
    // particles
    for (const p of this.parts) { p.t += dt; p.vy += (p.g || 500) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const p of this.parts) { ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = p.c; if (p.sh) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.t * 8); ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s / 2, 0, 7); ctx.fill(); } }
    ctx.globalAlpha = 1;
    // floating text
    ctx.textAlign = 'center'; ctx.lineJoin = 'round';
    for (const f of this.floaters) { f.t += dt; const a = 1 - f.t / 0.9; if (a <= 0) continue; ctx.globalAlpha = a; ctx.font = `900 ${f.size}px "Mona Sans", Arial`; ctx.lineWidth = 5; ctx.strokeStyle = '#1D1E3F'; const y = f.y - f.t * 50; ctx.strokeText(f.txt, f.x, y); ctx.fillStyle = f.col; ctx.fillText(f.txt, f.x, y); }
    this.floaters = this.floaters.filter((f) => f.t < 0.9); ctx.globalAlpha = 1;

    // red flash on damage
    if (this.flash > 0) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(226,59,78,${this.flash * 0.5})`; ctx.fillRect(0, 0, cv.width, cv.height); this.flash = Math.max(0, this.flash - dt * 1.5); }
  }
}
