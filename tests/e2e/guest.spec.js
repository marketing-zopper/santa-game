// Guest journey: no login, same game, and NOTHING stored or sent anywhere.
import { test, expect } from '@playwright/test';
import { enterAsGuest, clickPlay, botFor, waitForResults, introReady, roundStarted, waitForPlay, backToIntro, SUPABASE_URL, ANON_KEY } from './helpers.js';
// sign-in buttons only exist when the build has Supabase config (otherwise they would open a form that can't work)
const SIGN_IN = !!(SUPABASE_URL && ANON_KEY);

test.describe('Guest journey', () => {
  test('QR entry → loading → introduction → entry mode → guest → round starts straight away (no Game Home)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loader')).toBeVisible();                       // 2. loading
    await expect(page.locator('#loaderTip')).toContainText('…');
    await page.waitForSelector('#introScreen', { timeout: 20_000 });           // 3. introduction
    await expect(page.locator('.intro-card h2').first()).toContainText('How it works');
    await expect(page.locator('#introPrizes')).toContainText('Free Device Doctor plan');   // default prize option
    await expect(page.locator('#introPrizes .ph-perks li')).toHaveCount(4);
    await expect(page.locator('#introDates')).toHaveText('Challenge runs till 31 January 2027. Winners announced on 1 February 2027');
    await expect(page.locator('#knowMore')).toHaveCount(0);                    // "Know more" was removed
    await expect(page.locator('.player-card')).toHaveCount(0);                 // nobody chosen yet: no player card, Continue not Play
    await expect(page.locator('#introPlay')).toHaveCount(0);
    await page.click('#introContinue');
    await page.waitForSelector('#entrySheet');                                 // 4. choose entry mode
    await expect(page.locator('#signInBtn')).toBeVisible();
    await expect(page.locator('#signInBtn')).toHaveText('Sign in with WhatsApp');
    await expect(page.locator('#guestBtn')).toBeVisible();
    await expect(page.locator('#guestBtn')).toHaveText('Play as guest');
    await expect(page.locator('.entry-card')).toHaveCount(2);
    await page.click('#guestBtn');
    await expect(page.locator('#count')).toBeVisible();                        // 5. straight into a round: countdown + HUD
    await expect(page.locator('#hud')).toBeVisible();
    await expect(page.locator('#startScreen')).toHaveCount(0);                 // Game Home is never shown
    await expect(page.locator('#entrySheet')).toHaveCount(0);
    await waitForPlay(page);
    await expect(page.locator('#startScreen')).toHaveCount(0);
  });

  test('entry mode: back returns to the introduction', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 20_000 });
    await page.click('#introContinue');
    await page.waitForSelector('#entrySheet');
    await page.click('#entryBack');
    await expect(page.locator('#entrySheet')).toHaveCount(0);
    await expect(page.locator('#introScreen')).toBeVisible();
  });

  test('guests have NO leaderboard anywhere (in game, results, main menu)', async ({ page }) => {
    await enterAsGuest(page);
    await expect(page.locator('#leaderBtn')).toHaveCount(0);
    await expect(page.getByText('Leaderboard', { exact: true })).toHaveCount(0);
    await waitForPlay(page);
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    await expect(page.locator('#resultLeaderBtn')).toHaveCount(0);
    await expect(page.locator('#leaderSheet, .lb-list')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /leaderboard/i })).toHaveCount(0);
    await expect(page.locator('#result')).toContainText(/wasn.t saved/);
    if (SIGN_IN) await expect(page.locator('#result #resultSignInBtn')).toHaveText('Sign in to win');
    else await expect(page.locator('#resultSignInBtn')).toHaveCount(0);   // …but a way to sign in, inside the gold prize card
    await expect(page.locator('#result')).toContainText('Top 100 win a free Device Doctor plan');
    await backToIntro(page);                                                   // "Main menu" → the Introduction with a guest player card
    await expect(page.locator('.player-card')).toContainText('Playing as guest');
    await expect(page.locator('.player-card .pc-signin')).toHaveCount(SIGN_IN ? 1 : 0);
    await expect(page.locator('.pc-lb, #leaderBtn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /leaderboard/i })).toHaveCount(0);
    await expect(page.locator('#leaderSheet, .lb-list')).toHaveCount(0);
  });

  test('full round: countdown → play → game over → results → play again (repeatedly), one animation loop only', async ({ page }) => {
    await enterAsGuest(page);                                                  // choosing guest starts round 1
    let best = 0;
    for (let round = 1; round <= 3; round++) {
      if (round > 1) await clickPlay(page, '#againBtn');
      await expect(page.locator('#count')).toBeVisible();                      // 6. start game: countdown
      await expect(page.locator('#hud')).toBeVisible();
      await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 15_000 });
      await expect(page.locator('#banner')).toContainText('Catch!');
      await botFor(page, 7500);                                                // play long enough for the first phones to land
      if (round === 3) {                                                       // after repeated replays there must still be ONE loop (~60 fps), not two or more
        const fps = await page.evaluate(() => new Promise((res) => { const gm = window.__ssc.game, f0 = gm.frameCount, t0 = performance.now(); setTimeout(() => res((gm.frameCount - f0) / ((performance.now() - t0) / 1000)), 1500); }));
        expect(fps, 'frames per second (a duplicated loop would double it)').toBeLessThan(75);
        expect(fps).toBeGreaterThan(15);
      }
      const score = await page.evaluate(() => window.__ssc.game.sim.score);
      expect(score).toBeGreaterThan(0);
      await expect(page.locator('#score')).toHaveText(String(score));          // HUD follows the engine
      await page.evaluate(() => window.__ssc.game.quit());
      await expect(page.locator('#banner')).toContainText('Game over');        // 7. game over
      await waitForResults(page);                                              // 8. results
      best = Math.max(best, score);
      await expect(page.locator('#finalScore')).toHaveText(String(score));     // (waitForResults waited for the count-up to finish)
      await expect(page.locator('#stBest')).toHaveText(String(best));          // in-memory best for this visit
      await expect(page.locator('#againBtn')).toBeVisible();
    }
  });

  test('guest best score is kept in memory only: shown on the main menu, lost on refresh', async ({ page }) => {
    await enterAsGuest(page);
    await waitForPlay(page);
    await botFor(page, 7500);
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    const best = Number(await page.locator('#stBest').textContent());
    expect(best).toBeGreaterThan(0);
    await backToIntro(page);
    await expect(page.locator('.player-card strong')).toHaveText(String(best));   // "Your best this visit", remembered while the page lives
    await clickPlay(page);                                                     // Main menu → Play starts another guest round
    await roundStarted(page);
    await expect(page.locator('#hudBest')).toHaveText(String(best));
    await page.reload();                                                       // …and gone after a refresh
    await introReady(page);
    await expect(page.locator('.player-card')).toHaveCount(0);                 // a refresh forgets the guest entirely
    await page.click('#introContinue'); await page.click('#guestBtn'); await roundStarted(page);
    await expect(page.locator('#hudBest')).toHaveText('0');
  });

  test('ZERO persistence: no storage, no cookies, no network calls to Supabase for a guest', async ({ page, context }) => {
    const supabaseCalls = [];
    page.on('request', (r) => { if (/supabase\.co/.test(r.url())) supabaseCalls.push(r.method() + ' ' + r.url()); });
    await enterAsGuest(page);
    await page.click('#muteBtn');                                              // even a preference must not be stored for a guest
    await waitForPlay(page);
    await botFor(page, 3500);
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    await page.click('#againBtn');
    await waitForPlay(page);
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    await backToIntro(page);                                                   // the main menu (Intro + guest card) stores nothing either
    await clickPlay(page);
    await waitForPlay(page);
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);

    const stores = await page.evaluate(async () => ({
      local: Object.keys(localStorage), session: Object.keys(sessionStorage),
      idb: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [],
      caches: caches ? await caches.keys() : [],
    }));
    expect(stores.local).toEqual([]);
    expect(stores.session).toEqual([]);
    expect(stores.idb).toEqual([]);
    expect(stores.caches).toEqual([]);
    expect(await context.cookies()).toEqual([]);
    expect(supabaseCalls).toEqual([]);
  });

  test('pause / resume / end game (button and keyboard)', async ({ page }) => {
    await enterAsGuest(page);
    await waitForPlay(page);
    await page.click('#pauseBtn');
    await expect(page.locator('#pauseScreen')).toBeVisible();
    expect(await page.evaluate(() => window.__ssc.game.state)).toBe('pause');
    const t1 = await page.evaluate(() => window.__ssc.game.sim.tick);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.__ssc.game.sim.tick)).toBe(t1);   // truly frozen
    await page.click('#resumeBtn');
    await expect(page.locator('#pauseScreen')).toHaveCount(0);
    await page.waitForFunction(() => window.__ssc.game.state === 'play');
    await page.keyboard.press('p');                                            // keyboard pause
    await expect(page.locator('#pauseScreen')).toBeVisible();
    await page.keyboard.press('Escape');                                       // keyboard resume
    await expect(page.locator('#pauseScreen')).toHaveCount(0);
    await page.click('#pauseBtn');
    await page.click('#quitBtn');
    await waitForResults(page);
  });

  test('controls: touch swipe and keyboard move Santa', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'touch events are injected through the Chrome DevTools Protocol');
    await enterAsGuest(page);
    await waitForPlay(page);
    const x0 = await page.evaluate(() => window.__ssc.game.sim.target);
    const cdp = await page.context().newCDPSession(page);
    const y = 400;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y }] });
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 + i * 15, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const x1 = await page.evaluate(() => window.__ssc.game.sim.target);
    expect(x1).toBeGreaterThan(x0 + 40);                                       // swiped right → target moved right (×1.25 sensitivity)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 20, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const x2 = await page.evaluate(() => window.__ssc.game.sim.target);
    expect(x2).toBeLessThan(x1 - 60);                                          // swiped left
    await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(500); await page.keyboard.up('ArrowLeft');
    const x3 = await page.evaluate(() => window.__ssc.game.sim.target);
    expect(x3).toBeLessThan(x2);                                               // keyboard left
    await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
    expect(await page.evaluate(() => window.__ssc.game.sim.target)).toBeGreaterThan(x3);
  });

  test('audio: unlocks on the first tap, plays the countdown, and honours mute', async ({ page }) => {
    await page.addInitScript(() => {
      window.__audio = { contexts: 0, oscillators: 0 };
      const Orig = window.AudioContext;
      window.AudioContext = class extends Orig { constructor(...a) { super(...a); window.__audio.contexts++; } createOscillator() { window.__audio.oscillators++; return super.createOscillator(); } };
    });
    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 20_000 });
    // Playwright's WebKit build for Windows has no Web Audio at all (real Safari does); the game guards it, so there is nothing to measure
    test.skip(!(await page.evaluate(() => typeof (window.AudioContext || window.webkitAudioContext) === 'function')), 'this browser build has no Web Audio');
    expect(await page.evaluate(() => window.__audio.contexts)).toBe(0);        // nothing before a gesture
    await page.click('#introContinue');
    expect(await page.evaluate(() => window.__audio.contexts)).toBe(1);        // created by the first tap
    await page.click('#guestBtn');                                             // guest → the round (and its countdown) starts at once
    await waitForPlay(page);
    expect(await page.evaluate(() => window.__audio.oscillators)).toBeGreaterThanOrEqual(4);   // 3-2-1 beeps + go
    await page.click('#muteBtn');                                              // mute (the in-game sound button; there is no Game Home any more)
    await page.evaluate(() => window.__ssc.game.quit()); await waitForResults(page);
    const before = await page.evaluate(() => window.__audio.oscillators);
    await clickPlay(page, '#againBtn');
    await waitForPlay(page);
    expect(await page.evaluate(() => window.__audio.oscillators)).toBe(before); // muted: silent countdown
    await backToIntro(page);                                                   // …and still muted for a round started from the main menu
    await clickPlay(page);
    await waitForPlay(page);
    expect(await page.evaluate(() => window.__audio.oscillators)).toBe(before);
  });

  test('background music: starts on landing, audible on the first tap, loops, follows the sound button, keeps playing through a round, stores nothing', async ({ page, context, browserName }) => {
    const res = await page.request.get('/assets/christmas-bg-music.mp3');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toMatch(/audio\/mpeg|audio\/mp3/);

    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 20_000 });
    const st = () => page.evaluate(() => {
      const m = window.__ssc.music, a = m.el;
      return a ? { paused: a.paused, muted: a.muted, loop: a.loop, path: new URL(a.src).pathname, t: a.currentTime, dur: a.duration, vol: a.volume } : null;
    });

    // Landing: the music is ALREADY running. Chrome/Edge run with the real autoplay policy here (audio needs a tap), so it
    // must be playing silently (muted autoplay) until the first tap.
    await expect.poll(async () => { const s = await st(); return !!s && !s.paused; }, { timeout: 20_000 }).toBe(true);
    if (browserName === 'chromium') expect((await st()).muted).toBe(true);
    const landing = await st();
    await page.waitForTimeout(1200);
    expect((await st()).t).toBeGreaterThan(landing.t);                       // genuinely advancing before any tap

    await page.click('#introContinue');                                       // the first tap makes it audible
    await expect.poll(async () => { const s = await st(); return !!s && !s.paused && !s.muted; }, { timeout: 15_000 }).toBe(true);
    const s0 = await st();
    expect(s0.path).toBe('/assets/christmas-bg-music.mp3');
    expect(s0.loop).toBe(true);                                               // loops
    expect(s0.vol).toBeGreaterThan(0); expect(s0.vol).toBeLessThanOrEqual(0.5);
    await page.waitForTimeout(1500);
    expect((await st()).t).toBeGreaterThan(s0.t);                              // really playing

    await page.click('#guestBtn');                                            // guest → straight into a round
    await roundStarted(page);
    await expect.poll(async () => (await st()).paused).toBe(false);           // keeps playing across screens and through the countdown
    await waitForPlay(page);
    expect((await st()).paused).toBe(false);

    await page.click('#muteBtn');                                             // the sound button → pause
    await expect.poll(async () => (await st()).paused).toBe(true);
    const tPaused = (await st()).t;
    await page.waitForTimeout(800);
    expect((await st()).t).toBe(tPaused);                                      // truly stopped
    await page.click('#muteBtn');                                             // → play again, from where it stopped
    await expect.poll(async () => (await st()).paused).toBe(false);
    expect((await st()).t).toBeGreaterThanOrEqual(tPaused);

    await page.click('#pauseBtn');                                            // pausing the GAME does not stop the music
    await expect(page.locator('#pauseScreen')).toBeVisible();
    expect((await st()).paused).toBe(false);
    await page.click('#quitBtn');
    await waitForResults(page);
    expect((await st()).paused).toBe(false);
    await backToIntro(page);                                                  // …nor does going back to the main menu
    expect((await st()).paused).toBe(false);

    // loops: jump to the last half second, it must wrap around instead of ending
    await expect.poll(async () => Number.isFinite((await st()).dur)).toBe(true);
    await page.evaluate(() => { const a = window.__ssc.music.el; a.currentTime = a.duration - 0.4; });
    await expect.poll(async () => { const s = await st(); return s.t < 5 && !s.paused; }, { timeout: 10_000 }).toBe(true);

    // a guest's sound choice is never persisted
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    expect(await context.cookies()).toEqual([]);
  });
});
