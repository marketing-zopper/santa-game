// Signed-in journey against the real Supabase project. A temporary Auth user is created with the service-role key
// (read from the environment) and its session is injected, exactly what a returning Google player's browser holds.
// (A real Google consent screen cannot be automated; everything after the OAuth redirect is exercised here.)
import { test, expect } from '@playwright/test';
import { ANON_KEY, botFor, clickPlay, introReady, injectSession, makeTestUser, SERVICE_KEY, STORAGE_KEY, SUPABASE_URL, waitForResults } from './helpers.js';

test.skip(!SERVICE_KEY, 'set SUPABASE_SERVICE_ROLE_KEY to run the signed-in tests');
test.describe.configure({ mode: 'serial' });

let user;
test.beforeAll(async () => { user = await makeTestUser('player', 'E2E Player Test', { region: 'Croma West Region' }); });
test.afterAll(async () => { if (user) await user.cleanup(); });

const games = async () => (await user.admin.from('games').select('id, score, client_score, flagged, flag_reason, session_id, region').eq('player_id', user.id).order('created_at')).data;
const profile = async () => (await user.admin.from('profiles').select('best_score, games_played, display_name, region, phone, auth_provider').eq('id', user.id).single()).data;
// the saved-result card on Results: "#rank of N players" + either "You're in the top …" or "Break into the top …"
const SAVED = /You’re in the top|Break into the top/;
const bestOnCard = (page) => page.locator('.player-card .pc-stats span').first().locator('b');   // "Your best" on the Intro player card
const playRound = async (page, btn = '#introPlay', ms = 7500) => {
  await clickPlay(page, btn);
  await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 20_000 });
  await botFor(page, ms);
  await page.evaluate(() => window.__ssc.game.quit());
  await waitForResults(page);
};

test('returning user: valid session skips entry and lands on the Introduction with their player card and Play', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await introReady(page, { play: true });
  await expect(page.locator('#introContinue')).toHaveCount(0);                 // Play, not Continue → no Entry step
  await expect(page.locator('#entrySheet')).toHaveCount(0);
  await expect(page.locator('#startScreen')).toHaveCount(0);                   // Game Home is gone
  await expect(page.locator('.player-card.signed')).toContainText('Hi E2E');
  await expect(page.locator('.player-card .pc-link')).toContainText('Sign out');
  await expect(page.locator('.player-card .pc-lb')).toBeVisible();
  const pr = await profile();
  expect(pr.display_name).toBe('E2E Player Test');                             // profile row exists (created at registration)
  expect(pr.region).toBe('Croma West Region');
  expect(pr.auth_provider).toBe('phone');
});

test('signed-in round: server-issued session, validated score saved, rank shown, personal best updated', async ({ page, context }) => {
  await injectSession(context, user.session);
  const requests = [];
  page.on('request', (r) => { if (/functions\/v1\/(start|finish)-game/.test(r.url())) requests.push(new URL(r.url()).pathname.split('/').pop()); });
  await page.goto('/');
  await introReady(page, { play: true });
  await playRound(page);
  await expect(page.locator('#result')).toContainText(SAVED, { timeout: 20_000 });   // "Saving…" → confirmed result
  expect(requests).toEqual(['start-game', 'finish-game']);
  const score = Number(await page.locator('#finalScore').textContent());
  expect(score).toBeGreaterThan(0);
  const g = await games();
  expect(g).toHaveLength(1);
  expect(g[0].score).toBe(score);                                              // the server replayed the game and agrees
  expect(g[0].flagged).toBe(false);
  expect(g[0].region).toBe('Croma West Region');                               // region snapshot on the game
  expect((await profile()).best_score).toBe(score);
  await expect(page.locator('#resultSignInBtn')).toHaveCount(0);                // no redundant Sign In button for an authenticated player
  await expect(page.locator('#result .res-rank')).toBeVisible();               // ranked
  await expect(page.locator('#resultLeaderBtn')).toBeVisible();                // leaderboard offered to signed-in players
  await expect(page.locator('#stBest')).toHaveText(String(score));
});

test('leaderboard (signed-in only): own standing shown, only first-name + initial exposed', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await introReady(page, { play: true });
  await page.click('.player-card .pc-lb');
  await expect(page.locator('.lb-list li').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#lbMine')).toBeVisible();
  await expect(page.locator('#lbMine .who b')).toHaveText('E2E T.');
  const text = await page.locator('.sheet').innerText();
  expect(text).not.toContain('@');
  expect(text).not.toContain('E2E Player Test');                               // full name never shown to others
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('play again saves a second game; stats and personal best come from the database', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await introReady(page, { play: true });
  await playRound(page);
  await expect(page.locator('#result')).toContainText(SAVED, { timeout: 20_000 });
  await page.click('#resultLeaderBtn');                                        // 8. results → leaderboard
  await expect(page.locator('.lb-list li').first()).toBeVisible({ timeout: 15_000 });
  await page.click('.sheet [data-close]:not([data-play])');
  await playRound(page, '#againBtn');                                          // 8. results → play again (3rd game)
  await expect(page.locator('#result')).toContainText(SAVED, { timeout: 20_000 });
  const g = await games();
  expect(g).toHaveLength(3);
  expect(new Set(g.map((x) => x.session_id)).size).toBe(3);                    // distinct server sessions
  const p = await profile();
  expect(p.games_played).toBe(3);
  expect(p.best_score).toBe(Math.max(...g.map((x) => x.score)));
  expect(g.every((x) => !x.flagged)).toBe(true);
});

test('reload keeps the session and restores the saved best from Supabase', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await introReady(page, { play: true });
  const best = (await profile()).best_score;
  await expect(bestOnCard(page)).toHaveText(String(best));
  await page.reload();
  await introReady(page, { play: true });
  await expect(page.locator('#entrySheet')).toHaveCount(0);                    // still signed in: Play, no Entry step
  await expect(bestOnCard(page)).toHaveText(String(best));
});

test('anti-cheat: a tampered submission is replayed by the server — the server score wins and the claim is flagged', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.route('**/functions/v1/finish-game', async (route) => {
    const body = JSON.parse(route.request().postData());
    body.clientScore = body.clientScore + 100000;                              // claim a huge score…
    body.inputs = body.inputs.map((v, i) => (i % 2 === 1 ? v + 120 : v));      // …with doctored moves
    await route.continue({ postData: JSON.stringify(body) });
  });
  await page.goto('/');
  await introReady(page, { play: true });
  const before = (await games()).length;
  await playRound(page);
  await expect(page.locator('#result')).toContainText(/counted|You’re in the top|Break into the top/, { timeout: 20_000 });
  const g = (await games()).slice(before);
  expect(g).toHaveLength(1);
  expect(g[0].client_score).toBeGreaterThanOrEqual(100000);                    // what the browser claimed (audit only)
  expect(g[0].score).toBeLessThan(100000);                                     // what the server computed
  expect(g[0].flag_reason).toMatch(/client_mismatch/);
  expect((await profile()).best_score).toBeLessThan(100000);
});

test('retry safety: response lost after the server saved → queued, retried after Main menu, NO duplicate record', async ({ page, context }) => {
  await injectSession(context, user.session);
  let drop = true;
  await page.route('**/functions/v1/finish-game', async (route) => {
    if (!drop) return route.continue();
    await route.fetch();                                                       // the server receives and SAVES the game…
    await route.abort('connectionreset');                                      // …but the browser never gets the answer
  });
  await page.goto('/');
  await introReady(page, { play: true });
  const before = (await games()).length;
  await playRound(page);
  await expect(page.locator('#result')).toContainText('Score saved on this phone', { timeout: 20_000 });
  expect((await games()).length).toBe(before + 1);                             // saved exactly once so far
  const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ssc-pending:')));
  expect(queued).toHaveLength(1);
  drop = false;
  // NOTE: the app flushes the queue in an effect keyed to stage 'home'. Main menu now goes to 'intro' and #introPlay
  // calls startRound directly, so a returning player never passes through 'home' — this fails until the app flushes
  // the queue somewhere they do pass (see report). Intent kept: going back to the menu retries the unsent score.
  await page.click('#homeBtn');
  await introReady(page, { play: true });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), queued[0]), { timeout: 20_000 }).toBe('[]');
  expect((await games()).length).toBe(before + 1);                             // retry was recognised as a duplicate
});

test('a dropped connection is retried: one failed start-game and one failed finish-game do not cost the player a saved round', async ({ page, context }) => {
  await injectSession(context, user.session);
  const attempts = { start: 0, finish: 0 };
  await page.route('**/functions/v1/start-game', (route) => (++attempts.start === 1 ? route.abort('connectionreset') : route.continue()));
  await page.route('**/functions/v1/finish-game', (route) => (++attempts.finish === 1 ? route.abort('connectionreset') : route.continue()));
  await page.goto('/');
  await introReady(page, { play: true });
  const before = (await games()).length;
  await playRound(page);
  await expect(page.locator('#result')).toContainText(SAVED, { timeout: 25_000 });   // saved — not "Practice round", not "saved on this phone"
  await expect(page.locator('#result')).not.toContainText('Practice');
  expect(attempts.start).toBe(2);                                                           // retried once, then succeeded
  expect(attempts.finish).toBe(2);
  expect((await games()).length).toBe(before + 1);                                          // exactly one saved game
});

test('session is stored for the player; sign-out returns to the Introduction and clears it', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await introReady(page, { play: true });
  expect(await page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);
  await page.click('.player-card .pc-link');                                   // "Not you? Sign out" → a fresh Introduction
  await page.waitForSelector('#introContinue');
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
  await expect(page.locator('.player-card')).toHaveCount(0);
  await expect(page.locator('.pc-lb, #leaderBtn')).toHaveCount(0);
  await page.reload();                                                         // no session any more → full journey from the intro
  await introReady(page);
  await expect(page.locator('#introContinue')).toBeVisible();
});

test('signed-out visitor cannot reach leaderboard data (RPC refuses)', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async ([url, key]) => (await fetch(`${url}/rest/v1/rpc/get_leaderboard`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' })).status, [SUPABASE_URL, ANON_KEY]);
  expect([401, 403]).toContain(status);
});

test.describe('Google is for the admin dashboard only', () => {
  test('a leftover Google session in the browser is IGNORED by the game: treated as signed out, nothing created, nothing signed out', async ({ page, context }) => {
    const g = await makeTestUser('googleonly', 'Admin Like Google', { kind: 'google' });
    try {
      await injectSession(context, g.session);
      await page.goto('/');
      await page.waitForSelector('#introScreen', { timeout: 25_000 });                 // a normal new visitor: intro, not Game Home
      await expect(page.locator('#introPlay')).toHaveCount(0);                          // not signed in: Continue, no player card
      await page.click('#introContinue');
      await page.waitForSelector('#entrySheet');
      await expect(page.locator('#signInBtn')).toHaveText('Sign in with WhatsApp');
      await expect(page.locator('#googleBtn')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toMatch(/google/i);
      // the game never created a player profile for the Google account, and did not touch the stored session (the admin may still need it)
      expect((await g.admin.from('profiles').select('id').eq('id', g.id).maybeSingle()).data).toBeNull();
      expect(await page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);
      // guests can still play normally in that same browser
      await page.click('#guestBtn');                                                  // guest round starts straight away
      await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 20_000 });
      await page.evaluate(() => window.__ssc.game.quit());
      await waitForResults(page);
      await expect(page.locator('#resultLeaderBtn')).toHaveCount(0);
      await expect(page.locator('#resultSignInBtn')).toBeVisible();                   // a guest result
      await page.click('#homeBtn');
      await introReady(page, { play: true });
      await expect(page.locator('.player-card')).toContainText('Playing as guest');
      await expect(page.locator('.pc-lb, #leaderBtn')).toHaveCount(0);
    } finally { await g.cleanup(); }
  });
});
