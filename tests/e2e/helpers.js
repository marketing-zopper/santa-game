// Shared helpers for the browser tests.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fyjovgxvyuynlgjjucut.supabase.co';
export const ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_VRzQXLu7JWjWfZ7nctA34g_aM_neNdE';
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const STORAGE_KEY = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

/** Walk Loading → Intro → Entry Mode and choose Guest. Ends on Game Home. */
export async function enterAsGuest(page) {
  await page.goto('/');
  await page.waitForSelector('#introScreen', { timeout: 20_000 });
  await page.click('#introContinue');
  await page.waitForSelector('#entrySheet');
  await page.click('#guestBtn');
  await page.waitForSelector('#startScreen');
}

/** The Play button pulses forever, so Playwright never sees it as "stable": force the click. */
export const clickPlay = (page, sel = '#playBtn') => page.click(sel, { force: true });

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

/** Wait until the round is over and the Results screen is showing. */
export async function waitForResults(page, timeout = 60_000) {
  await page.waitForSelector('#overScreen', { timeout });
}

/** Create a temporary Auth user (confirmed email) and return a ready-made browser session for it. */
export async function makeTestUser(label, fullName) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, opts);
  const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `ssc-e2e-${label}-${stamp}@example.test`, password = `Pw-${stamp}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName, email_verified: true } });
  if (error) throw error;
  const anon = createClient(SUPABASE_URL, ANON_KEY, opts);
  const { data: s, error: e2 } = await anon.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return {
    id: data.user.id, email, session: s.session, admin,
    async cleanup() { await admin.auth.admin.deleteUser(data.user.id); await admin.from('admin_users').delete().eq('email', email); },
  };
}

/** Put the user's session into localStorage before the app loads (what a returning visitor already has). */
export async function injectSession(context, session) {
  await context.addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch (e) { /* ignore */ } }, [STORAGE_KEY, JSON.stringify(session)]);
}
