// Signed-in journey against the real Supabase project. A temporary Auth user is created with the service-role key
// (read from the environment) and its session is injected, exactly what a returning Google player's browser holds.
// (A real Google consent screen cannot be automated; everything after the OAuth redirect is exercised here.)
import { test, expect } from '@playwright/test';
import { ANON_KEY, botFor, clickPlay, homeReady, injectSession, makeTestUser, SERVICE_KEY, STORAGE_KEY, SUPABASE_URL, waitForResults } from './helpers.js';

test.skip(!SERVICE_KEY, 'set SUPABASE_SERVICE_ROLE_KEY to run the signed-in tests');
test.describe.configure({ mode: 'serial' });

let user;
test.beforeAll(async () => { user = await makeTestUser('player', 'E2E Player Test', { region: 'Croma West Region' }); });
test.afterAll(async () => { if (user) await user.cleanup(); });

const games = async () => (await user.admin.from('games').select('id, score, client_score, flagged, flag_reason, session_id, region').eq('player_id', user.id).order('created_at')).data;
const profile = async () => (await user.admin.from('profiles').select('best_score, games_played, display_name, region, phone, auth_provider').eq('id', user.id).single()).data;
const playRound = async (page, btn = '#playBtn', ms = 7500) => {
  await clickPlay(page, btn);
  await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 20_000 });
  await botFor(page, ms);
  await page.evaluate(() => window.__ssc.game.quit());
  await waitForResults(page);
};

test('returning user: valid session skips intro + entry and lands on Game Home with signed-in options', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await homeReady(page);
  await expect(page.locator('#introScreen')).toHaveCount(0);
  await expect(page.locator('#entrySheet')).toHaveCount(0);
  await expect(page.locator('#playerName')).toHaveText('E2E Player Test');
  await expect(page.locator('#playerChip')).toContainText('Sign out');
  await expect(page.locator('#leaderBtn')).toBeVisible();
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
  await homeReady(page);
  await playRound(page);
  await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });   // "Saving…" → confirmed result
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
  await expect(page.locator('#result .r-rank')).toBeVisible();                 // ranked
  await expect(page.locator('#resultLeaderBtn')).toBeVisible();                // leaderboard offered to signed-in players
  await expect(page.locator('#stBest')).toHaveText(String(score));
});

test('leaderboard (signed-in only): own standing shown, only first-name + initial exposed', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await homeReady(page);
  await page.click('#leaderBtn');
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
  await homeReady(page);
  await playRound(page);
  await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });
  await page.click('#resultLeaderBtn');                                        // 8. results → leaderboard
  await expect(page.locator('.lb-list li').first()).toBeVisible({ timeout: 15_000 });
  await page.click('.sheet [data-close]:not([data-play])');
  await playRound(page, '#againBtn');                                          // 8. results → play again (3rd game)
  await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });
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
  await homeReady(page);
  const best = (await profile()).best_score;
  await expect(page.locator('#menuBest')).toHaveText(String(best));
  await page.reload();
  await homeReady(page);
  await expect(page.locator('#introScreen')).toHaveCount(0);
  await expect(page.locator('#menuBest')).toHaveText(String(best));
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
  await homeReady(page);
  const before = (await games()).length;
  await playRound(page);
  await expect(page.locator('#result')).toContainText(/best|counted/i, { timeout: 20_000 });
  const g = (await games()).slice(before);
  expect(g).toHaveLength(1);
  expect(g[0].client_score).toBeGreaterThanOrEqual(100000);                    // what the browser claimed (audit only)
  expect(g[0].score).toBeLessThan(100000);                                     // what the server computed
  expect(g[0].flag_reason).toMatch(/client_mismatch/);
  expect((await profile()).best_score).toBeLessThan(100000);
});

test('retry safety: response lost after the server saved → queued, retried on Game Home, NO duplicate record', async ({ page, context }) => {
  await injectSession(context, user.session);
  let drop = true;
  await page.route('**/functions/v1/finish-game', async (route) => {
    if (!drop) return route.continue();
    await route.fetch();                                                       // the server receives and SAVES the game…
    await route.abort('connectionreset');                                      // …but the browser never gets the answer
  });
  await page.goto('/');
  await homeReady(page);
  const before = (await games()).length;
  await playRound(page);
  await expect(page.locator('#result')).toContainText('Score saved on this phone', { timeout: 20_000 });
  expect((await games()).length).toBe(before + 1);                             // saved exactly once so far
  const queued = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ssc-pending:')));
  expect(queued).toHaveLength(1);
  drop = false;
  await page.click('#homeBtn');                                                // Game Home flushes the queue
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), queued[0]), { timeout: 20_000 }).toBe('[]');
  expect((await games()).length).toBe(before + 1);                             // retry was recognised as a duplicate
});

test('session is stored for the player; sign-out returns to Entry and clears it', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/');
  await homeReady(page);
  expect(await page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);
  await page.click('#playerChip');
  await page.waitForSelector('#entrySheet');                                   // "switch player" → Entry mode
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
  await expect(page.locator('#leaderBtn')).toHaveCount(0);
  await page.reload();                                                         // no session any more → full journey from the intro
  await page.waitForSelector('#introScreen', { timeout: 25_000 });
});

test('signed-out visitor cannot reach leaderboard data (RPC refuses)', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async ([url, key]) => (await fetch(`${url}/rest/v1/rpc/get_leaderboard`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' })).status, [SUPABASE_URL, ANON_KEY]);
  expect([401, 403]).toContain(status);
});

test.describe('legacy Google player (history is preserved, no region invented)', () => {
  test('a valid legacy Google session still restores to Game Home; their games carry no region', async ({ page, context }) => {
    const legacy = await makeTestUser('legacy', 'Legacy Googler', { kind: 'google' });
    try {
      await injectSession(context, legacy.session);
      await page.goto('/');
      await homeReady(page);
      await expect(page.locator('#playerName')).toHaveText('Legacy Googler');
      await expect(page.locator('#leaderBtn')).toBeVisible();
      await playRound(page);
      await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });
      const g = (await legacy.admin.from('games').select('region').eq('player_id', legacy.id)).data;
      expect(g).toHaveLength(1);
      expect(g[0].region).toBeNull();
      const pr = (await legacy.admin.from('profiles').select('region, auth_provider').eq('id', legacy.id).single()).data;
      expect(pr).toEqual({ region: null, auth_provider: 'google' });
    } finally { await legacy.cleanup(); }
  });
});
