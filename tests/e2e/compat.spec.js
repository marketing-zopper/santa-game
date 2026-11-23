// Cross-browser compatibility (runs in Chrome, Edge, Firefox and WebKit/Safari-engine — see playwright.config.js).
import { test, expect } from '@playwright/test';
import { enterAsGuest, clickPlay, botFor, waitForResults } from './helpers.js';

test.describe('Cross-browser', () => {
  test('loads without script errors and gets through the whole guest journey', async ({ page, browserName }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/autoplay|play\(\)|NotAllowed|favicon/i.test(m.text())) errors.push(m.text()); });
    await enterAsGuest(page);
    await clickPlay(page);
    await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 25_000 });
    await botFor(page, 7500);
    expect(await page.evaluate(() => window.__ssc.game.sim.score)).toBeGreaterThan(0);          // the canvas engine really plays here
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    await expect(page.locator('#resultSignInBtn')).toBeVisible();
    expect(errors, `${browserName}: ${errors.join(' | ')}`).toEqual([]);
  });

  test('browser features the game relies on are present', async ({ page, browserName }) => {
    await page.goto('/');
    const f = await page.evaluate(() => ({
      canvas2d: !!document.createElement('canvas').getContext('2d'),
      raf: typeof requestAnimationFrame === 'function',
      pointer: 'PointerEvent' in window,
      audio: typeof (window.AudioContext || window.webkitAudioContext) === 'function',
      media: typeof Audio === 'function',
      backdrop: CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)'),
      has: CSS.supports('selector(:has(a))'),
      fontStretch: CSS.supports('font-stretch', '108%'),
      vh: CSS.supports('height', '100dvh') || CSS.supports('height', '100vh'),
      env: CSS.supports('padding-top', 'env(safe-area-inset-top, 0px)'),
    }));
    expect(f).toMatchObject({ canvas2d: true, raf: true, pointer: true, media: true, backdrop: true, fontStretch: true, vh: true });
    // Playwright's WebKit build for Windows ships without Web Audio; real Safari has it. The game guards every use of it (the
    // sound effects are simply silent), so this is recorded rather than failed.
    if (!f.audio) test.info().annotations.push({ type: 'note', description: `${browserName}: no Web Audio in this browser build — sound effects would be silent, game still runs` });
  });

  test('registration form: controls are readable and will not trigger iOS zoom', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 25_000 });
    await page.click('#introContinue');
    await page.click('#signInBtn');
    await page.waitForSelector('#regForm');
    const s = await page.evaluate(() => {
      const cs = (sel) => getComputedStyle(document.querySelector(sel));
      return { name: parseFloat(cs('#regName').fontSize), phone: parseFloat(cs('#regPhone').fontSize), region: parseFloat(cs('#regRegion').fontSize), scheme: cs('#regRegion').colorScheme,
        optBg: getComputedStyle(document.querySelector('#regRegion option:not([disabled])')).backgroundColor };
    });
    for (const k of ['name', 'phone', 'region']) expect(s[k], `${k} font-size`).toBeGreaterThanOrEqual(16);   // < 16px makes iOS Safari zoom on focus
    expect(s.scheme).toBe('light');                                                                       // dropdown popup is not dark-on-navy
    // the region list really has the four options and can be chosen with the native control in every browser
    await page.selectOption('#regRegion', 'Croma West Region');
    await expect(page.locator('#regRegion')).toHaveValue('Croma West Region');
  });

  test('the guest result screen is usable: buttons visible, nothing clipped', async ({ page }) => {
    await enterAsGuest(page);
    await clickPlay(page);
    await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 25_000 });
    await page.evaluate(() => window.__ssc.game.quit());
    await waitForResults(page);
    for (const sel of ['#againBtn', '#resultSignInBtn', '#homeBtn']) { await page.locator(sel).scrollIntoViewIfNeeded(); await expect(page.locator(sel)).toBeVisible(); }
  });

  test('background music: playing from landing (silently if the browser demands a tap) and audible after the first tap', async ({ page, browserName }) => {
    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 25_000 });
    const st = () => page.evaluate(() => { const a = window.__ssc.music.el; return a ? { paused: a.paused, muted: a.muted, loop: a.loop, t: a.currentTime } : null; });
    // on landing: already running (audibly where allowed, otherwise muted autoplay)
    await expect.poll(async () => { const s = await st(); return !!s && !s.paused; }, { timeout: 20_000, message: `${browserName}: music did not start on landing` }).toBe(true);
    expect((await st()).loop).toBe(true);
    await page.click('#introContinue');                                         // the first tap: now it must be audible
    await expect.poll(async () => { const s = await st(); return !!s && !s.paused && !s.muted; }, { timeout: 15_000, message: `${browserName}: music not audible after the first tap` }).toBe(true);
  });
});
