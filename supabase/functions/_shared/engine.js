/* Santa's Safe Catch — deterministic engine (fixed 60 ticks/s, seeded RNG). Shared by game + tuning sims.
 *
 * SINGLE SOURCE OF TRUTH. This exact file is imported by:
 *   - the React game (src/game/engine.js re-exports it), and
 *   - the Supabase Edge Function that re-plays and validates every signed-in score (finish-game).
 * The game logic below is the original engine.js, unchanged — only the module wrapper (export keywords) differs.
 * Do not edit the rules here without understanding that it changes score validation too.
 */
export const CFG = {
  W: 400, H: 720,
  SPAWN_Y: -20, CATCH_Y: 620, GROUND_Y: 700,
  SLEIGH_SPEED: 480,      // max sleigh speed (units/s) — the hard physical limit
  CATCH_HALF: 34,         // half-width of the sack opening
  X_MIN: 34, X_MAX: 366,
  LIVES: 3, MAX_LIVES: 3,
  // difficulty curve (t = seconds survived)
  fall: t => Math.min(620, 130 + 4 * t + 0.03 * t * t) + Math.max(0, t - 100) * 1.2,
  interval: t => Math.max(0.34, Math.max(0.48, 1.3 - 0.005 * t - 0.00008 * t * t) - Math.max(0, t - 100) * 0.0008),
  jump: t => Math.min(300, 90 + 3 * t),
  minJump: t => 0,                            // no wall: endless, keeps getting slowly harder
  coalChance: t => Math.min(0.28, Math.max(0, (t - 8) * 0.006)),
  goldChance: t => (t > 5 ? 0.07 : 0),
  phonePts: t => Math.min(40, 10 + 2 * Math.floor(t / 10)),
  goldMult: 4,
  shieldEvery: 35, shieldUntil: 1e9,
};
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

export class Sim {
  constructor(seed, cfg) {
    this.c = Object.assign({}, CFG, cfg || {});
    this.r = rng(seed); this.tick = 0; this.t = 0;
    this.x = this.c.W / 2; this.target = this.x;
    this.lives = this.c.LIVES; this.score = 0; this.caught = 0; this.over = false;
    this.items = []; this.nextSpawn = 0.8; this.lastX = this.c.W / 2; this.nextShield = this.c.shieldEvery; this.id = 0;
    this.events = [];
  }
  setTarget(x) { this.target = Math.max(this.c.X_MIN, Math.min(this.c.X_MAX, x)); }
  spawn() {
    const c = this.c, t = this.t, r = this.r, v = c.fall(t);
    if (t >= this.nextShield && t < c.shieldUntil && this.lives < c.MAX_LIVES) {
      this.nextShield = t + c.shieldEvery;
      this.items.push({ id: ++this.id, type: 'shield', x: c.X_MIN + r() * (c.X_MAX - c.X_MIN), y: c.SPAWN_Y, vy: v * 0.8, spin: r() * 6 });
      return;
    }
    const J = Math.min(c.X_MAX - c.X_MIN, c.jump(t));
    const mJ = Math.min(J, c.minJump(t));
    let dir = r() < 0.5 ? -1 : 1;
    if (this.lastX + dir * mJ < c.X_MIN || this.lastX + dir * mJ > c.X_MAX) dir = -dir;
    let x = this.lastX + dir * (mJ + r() * (J - mJ));
    if (x < c.X_MIN) x = c.X_MIN + (c.X_MIN - x); if (x > c.X_MAX) x = c.X_MAX - (x - c.X_MAX);
    x = Math.max(c.X_MIN, Math.min(c.X_MAX, x));
    this.lastX = x;
    const gold = r() < c.goldChance(t);
    const kind = r() * 4 | 0;
    this.items.push({ id: ++this.id, type: gold ? 'gold' : 'phone', kind, x, y: c.SPAWN_Y, vy: v * (gold ? 1.2 : 1), spin: (r() * 2 - 1) * 0.5 });
    if (r() < c.coalChance(t)) {
      const side = r() < 0.5 ? -1 : 1, off = 55 + r() * 40;
      let cx = x + side * off; if (cx < c.X_MIN || cx > c.X_MAX) cx = x - side * off;
      this.items.push({ id: ++this.id, type: 'coal', x: cx, y: c.SPAWN_Y - 30 - r() * 60, vy: v * (0.95 + r() * 0.15), spin: r() * 6 });
    }
  }
  step() {
    if (this.over) return;
    const c = this.c, dt = 1 / 60;
    this.tick++; this.t = this.tick / 60;
    const d = this.target - this.x, m = c.SLEIGH_SPEED * dt;
    this.x += Math.abs(d) <= m ? d : Math.sign(d) * m;
    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) { this.spawn(); this.nextSpawn += c.interval(this.t); }
    for (const it of this.items) {
      const py = it.y; it.y += it.vy * dt;
      if (!it.done && py < c.CATCH_Y && it.y >= c.CATCH_Y) {
        if (Math.abs(it.x - this.x) <= c.CATCH_HALF) {
          it.done = 'caught';
          if (it.type === 'coal') { this.lives--; this.events.push({ e: 'coal', it }); }
          else if (it.type === 'shield') { this.lives = Math.min(c.MAX_LIVES, this.lives + 1); this.events.push({ e: 'shield', it }); }
          else { const p = c.phonePts(this.t) * (it.type === 'gold' ? c.goldMult : 1); this.score += p; this.caught++; this.events.push({ e: 'catch', it, p }); }
        }
      }
      if (!it.done && it.y >= c.GROUND_Y) {
        it.done = 'ground';
        if (it.type === 'phone' || it.type === 'gold') { this.lives--; this.events.push({ e: 'miss', it }); }
      }
    }
    this.items = this.items.filter(it => !it.done);
    if (this.lives <= 0) { this.lives = 0; this.over = true; this.events.push({ e: 'over' }); }
  }
}
// Server-side check: re-run a game from its seed and the recorded sleigh targets.
// inputs = [tick, x, tick, x, ...] — before step number `tick`, the target becomes x.
export function replay(seed, inputs, endTick, maxTicks) {
  const s = new Sim(seed); let k = 0; const lim = Math.min(endTick || Infinity, maxTicks || 60 * 60 * 30);
  while (!s.over && s.tick < lim) {
    while (k < inputs.length && inputs[k] <= s.tick + 1) { s.setTarget(inputs[k + 1]); k += 2; }
    s.step();
  }
  return { score: s.score, caught: s.caught, t: s.t, ticks: s.tick, over: s.over };
}
// Convenience namespace (the original engine exposed { CFG, Sim, rng, replay }).
export const SantaEngine = { CFG, Sim, rng, replay };
