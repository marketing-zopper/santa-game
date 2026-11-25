// Shared helpers for the browser tests.
import { createClient } from '@supabase/supabase-js';

// Config comes from the environment / .env.local — nothing project-specific is hardcoded here.
try { process.loadEnvFile('.env.local'); } catch (e) { /* no .env.local: rely on the shell environment */ }
export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';
export const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const STORAGE_KEY = SUPABASE_URL ? `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token` : 'sb-unconfigured-auth-token';
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** The Introduction is showing AND the loading screen has finished fading out (it would otherwise swallow clicks).
 *  With `play: true`, also waits for the "Main menu" variant: a player is chosen, so the bottom button is Play (#introPlay). */
export async function introReady(page, { play = false, timeout = 25_000 } = {}) {
  await page.waitForSelector('#introScreen', { timeout });
  await page.waitForSelector('#loader', { state: 'detached', timeout });
  if (play) await page.waitForSelector('#introPlay', { timeout });
}

/** A round has started: the countdown / play state with the HUD on screen. */
export async function roundStarted(page, timeout = 20_000) {
  await page.waitForFunction(() => { const s = window.__ssc && window.__ssc.game.state; return s === 'count' || s === 'play'; }, null, { timeout });
  await page.waitForSelector('#hud', { timeout });
}

/** Wait until the countdown is over and Santa is actually playing. */
export const waitForPlay = (page, timeout = 20_000) => page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout });

/** Walk Loading → Intro → Entry Mode and choose Guest. Choosing guest starts a round straight away: ends once it has started. */
export async function enterAsGuest(page) {
  await page.goto('/');
  await introReady(page);
  await page.click('#introContinue');
  await page.waitForSelector('#entrySheet');
  await page.click('#guestBtn');
  await roundStarted(page);
}

/** Results → "Main menu": back on the Introduction, which now offers Play (#introPlay). */
export async function backToIntro(page) {
  await page.click('#homeBtn');
  await introReady(page, { play: true });
}

/** The Play buttons may pulse, so Playwright never sees them as "stable": force the click. (#introPlay on the Intro, #againBtn on Results) */
export const clickPlay = (page, sel = '#introPlay') => page.click(sel, { force: true });

/** Make Santa catch phones like the attract-mode demo does, for `ms` milliseconds (needs the e2e test hook). */
export async function botFor(page, ms) {
  await page.evaluate((ms) => new Promise((resolve) => {
    const g = window.__ssc.game, t0 = performance.now();
    const id = setInterval(() => {
      const s = g.sim;
      if (performance.now() - t0 > ms || !s || s.over) { clearInterval(id); resolve(); return; }
      if (g.state !== 'play') return;
      const c = s.c;
      const goods = s.items.filter((i) => i.type !== 'coal' && i.y < c.CATCH_Y).map((i) => ({ i, tau: (c.CATCH_Y - i.y) / i.vy })).sort((a, b) => a.tau - b.tau);
      let pos = s.x, pt = 0, tgt = null;
      for (const q of goods) if (Math.abs(q.i.x - pos) <= c.SLEIGH_SPEED * 0.7 * (q.tau - pt) + 20) { if (tgt == null) tgt = q.i.x; pos = q.i.x; pt = q.tau; }
      if (tgt != null) s.setTarget(tgt);
    }, 16);
  }), ms);
}

/** Wait until the round is over, the Results screen is showing and the score has finished counting up from 0. */
export async function waitForResults(page, timeout = 60_000) {
  await page.waitForSelector('#overScreen', { timeout });
  await page.waitForFunction(() => {
    const e = document.querySelector('#finalScore');
    return !!e && e.getAttribute('aria-label') === 'Your score: ' + e.textContent.trim();
  }, null, { timeout: 10_000 });
}

/** Reserved test numbers (Supabase fixed-OTP numbers during the run; the Send-SMS hook never messages them). */
export const TEST_PHONES = Array.from({ length: 12 }, (_, i) => '600000' + (1010 + i));   // 6000001010 … 6000001021
export const OTP_CODE = () => process.env.E2E_OTP_CODE || '';
export const PHONE_UI_READY = () => !!(SERVICE_KEY && process.env.E2E_OTP_CODE);

const randomMobile = () => '91' + String(6 + Math.floor(Math.random() * 4)) + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');

/**
 * Create a temporary Auth user and return a ready-made browser session for it.
 *   kind 'phone'  (default) a verified phone player, already registered with a name + Croma region — the normal player
 *   kind 'google' a LEGACY Google player (also what the admin dashboard uses)
 *   kind 'unregistered' a phone whose OTP was verified but who never finished registration
 */
export async function makeTestUser(label, fullName, { kind = 'phone', region = 'Croma East Region', phone } = {}) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, opts);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const password = `Pw-${stamp}!`;
  const anon = createClient(SUPABASE_URL, ANON_KEY, opts);
  let id, email = null, e164 = null, session;
  if (kind === 'google') {
    email = `ssc-e2e-${label}-${stamp}@example.test`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: fullName, email_verified: true } });
    if (error) throw error;
    id = data.user.id;
    const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
    if (e2) throw e2;
    session = s.session;
  } else {
    const num = phone ? '91' + phone : randomMobile();
    e164 = '+' + num;
    const { data, error } = await admin.auth.admin.createUser({ phone: num, phone_confirm: true, password });
    if (error) throw error;
    id = data.user.id;
    const { data: s, error: e2 } = await anon.auth.signInWithPassword({ phone: e164, password });
    if (e2) throw e2;
    session = s.session;
    if (kind === 'phone') { const { error: e3 } = await anon.rpc('complete_registration', { p_name: fullName, p_region: region }); if (e3) throw e3; }
  }
  return {
    id, email, phone: e164, session, admin,
    async cleanup() { await admin.auth.admin.deleteUser(id); if (email) await admin.from('admin_users').delete().eq('email', email); },
  };
}

/** Remove any Auth users (and, by cascade, profiles / sessions / games) created for the given reserved test numbers. */
export async function deleteUsersByPhone(...phones10) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, opts);
  const want = new Set(phones10.map((p) => '91' + p));
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of (data && data.users) || []) if (u.phone && want.has(u.phone)) await admin.auth.admin.deleteUser(u.id);
}

/** Put the user's session into localStorage before the app loads (what a returning visitor already has). */
export async function injectSession(context, session) {
  // one-shot per tab: otherwise a reload after "sign out" would put the session straight back
  await context.addInitScript(([key, value]) => {
    try { if (!sessionStorage.getItem('__e2e_injected')) { localStorage.setItem(key, value); sessionStorage.setItem('__e2e_injected', '1'); } } catch (e) { /* ignore */ }
  }, [STORAGE_KEY, JSON.stringify(session)]);
}
