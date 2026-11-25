// Responsive layout, canvas scaling (sprites never distorted) and orientation handling.
import { test, expect } from '@playwright/test';
import { enterAsGuest, roundStarted, waitForPlay, backToIntro, SUPABASE_URL, ANON_KEY } from './helpers.js';
// sign-in buttons only exist when the build has Supabase config (otherwise they would open a form that can't work)
const SIGN_IN = !!(SUPABASE_URL && ANON_KEY);

const PHONES = [
  ['iPhone SE (320x568)', 320, 568], ['Android small (360x640)', 360, 640], ['iPhone 13 (390x844)', 390, 844],
  ['Pixel 7 (412x915)', 412, 915], ['iPhone Pro Max (430x932)', 430, 932],
  ['Tablet portrait (768x1024)', 768, 1024], ['iPad Air (820x1180)', 820, 1180], ['iPad Pro (1024x1366)', 1024, 1366], ['Tablet landscape (1024x768)', 1024, 768],
  ['Laptop (1366x768)', 1366, 768], ['Laptop short (1366x600)', 1366, 600], ['Laptop (1536x864)', 1536, 864], ['Desktop (1280x800)', 1280, 800],
  ['Full HD (1920x1080)', 1920, 1080], ['QHD (2560x1440)', 2560, 1440], ['Ultrawide (2560x1080)', 2560, 1080],
];

const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1);
const inViewport = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox();
  const vp = page.viewportSize();
  return !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1;
};
// On every screen size the UI stays phone-sized: #app is a centred column at most 480px wide and nothing is zoomed up
const COLUMN = 480;
const column = (page) => page.evaluate(() => {
  const r = document.getElementById('app').getBoundingClientRect();
  return { x: r.x, w: r.width, zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1 };
});
const inColumn = async (page, sel) => {
  const b = await page.locator(sel).first().boundingBox(), c = await column(page);
  return !!b && b.x >= c.x - 1 && b.x + b.width <= c.x + c.w + 1;
};

for (const [name, width, height] of PHONES) {
  test(`${name}: every screen fits, nothing overflows sideways, controls reachable`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.waitForSelector('#introScreen', { timeout: 20_000 });
    await page.waitForSelector('#loader', { state: 'detached' });
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await inViewport(page, '#introContinue')).toBe(true);
    {
      const c = await column(page);
      expect(c.zoom, 'UI is never scaled up').toBe(1);
      expect(c.w, 'the app is a phone-width column').toBeLessThanOrEqual(COLUMN + 0.5);
      expect(c.w).toBeCloseTo(Math.min(width, COLUMN), 0);
      expect(Math.abs(c.x - (width - (c.x + c.w))), 'the column is centred').toBeLessThanOrEqual(1);
      expect(await inColumn(page, '#introContinue'), 'Continue stays in the centred column').toBe(true);
      expect(await inColumn(page, '#introPrizes'), 'prize card stays in the centred column').toBe(true);
    }
    await page.screenshot({ path: `test-results/shots/${width}x${height}-1-intro.png` });

    await page.click('#introContinue');
    await page.waitForSelector('#entrySheet');
    await page.waitForTimeout(450);                                              // sheet "rise" animation
    expect(await noHorizontalScroll(page)).toBe(true);
    const panel = await page.locator('#entrySheet').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
    expect(panel.width, 'entry sheet stays phone-sized').toBeLessThanOrEqual(COLUMN + 1);
    // both choices are always reachable (the panel scrolls inside the screen on very short displays)
    await page.locator('#signInBtn').scrollIntoViewIfNeeded();
    await expect(page.locator('#signInBtn')).toBeVisible();
    await page.locator('#guestBtn').scrollIntoViewIfNeeded();
    await expect(page.locator('#guestBtn')).toBeVisible();
    await page.screenshot({ path: `test-results/shots/${width}x${height}-2-entry.png` });

    await page.click('#guestBtn');                                               // guest → straight into a round (no Game Home)
    await roundStarted(page);
    await waitForPlay(page);
    expect(await noHorizontalScroll(page)).toBe(true);
    for (const sel of ['#score', '#lives', '#pauseBtn', '#muteBtn']) expect(await inViewport(page, sel), `${sel} inside the viewport`).toBe(true);
    {
      const h = await page.locator('#hud').boundingBox();                          // the HUD is centred over the playfield, not in the far corners
      expect(Math.abs(h.x - (width - (h.x + h.width))), 'HUD is centred').toBeLessThanOrEqual(3);
      expect(h.width, 'HUD stays inside the phone-width column').toBeLessThanOrEqual(COLUMN + 1);
    }
    // canvas backing store has exactly the CSS box's aspect ratio, and the playfield is scaled uniformly → sprites are never stretched
    const m = await page.evaluate(() => {
      const c = document.getElementById('game'), r = c.getBoundingClientRect(), g = window.__ssc.game;
      return { bw: c.width, bh: c.height, cw: r.width, ch: r.height, sc: g.sc, ox: g.ox, oy: g.oy, dpr: g.dpr, W: 400, H: 720 };
    });
    expect(Math.abs(m.bw / m.bh - m.cw / m.ch)).toBeLessThan(0.01);
    expect(m.sc).toBeCloseTo(Math.min(m.cw / m.W, m.ch / m.H), 5);               // one scale factor for both axes
    expect(m.ox).toBeGreaterThanOrEqual(-0.5);
    expect(m.oy).toBeGreaterThanOrEqual(-0.5);
    await page.screenshot({ path: `test-results/shots/${width}x${height}-4-play.png` });
    await page.evaluate(() => window.__ssc.game.quit());
    await page.waitForSelector('#overScreen');
    await page.waitForTimeout(450);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.locator('#againBtn').scrollIntoViewIfNeeded();
    await expect(page.locator('#againBtn')).toBeVisible();
    await page.screenshot({ path: `test-results/shots/${width}x${height}-5-results.png` });
    if (SIGN_IN) {   // the registration form only exists when sign-in is configured
      // the guest result screen offers "Sign In with OTP"; the registration form fits and every field + the Send OTP button are reachable
      await page.locator('#resultSignInBtn').scrollIntoViewIfNeeded();
      await expect(page.locator('#resultSignInBtn')).toBeVisible();
      await page.click('#resultSignInBtn');
      await page.waitForSelector('#authSheet');
      await page.waitForTimeout(450);
      expect(await noHorizontalScroll(page)).toBe(true);
      for (const sel of ['#regName', '#regRegion', '#regPhone', '#regSubmit']) { await page.locator(sel).scrollIntoViewIfNeeded(); await expect(page.locator(sel), `${sel} reachable`).toBeVisible(); }
      const sheet = await page.locator('#authSheet').boundingBox();
      expect(sheet.x).toBeGreaterThanOrEqual(0);
      expect(sheet.x + sheet.width).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `test-results/shots/${width}x${height}-6-register.png` });
      await page.click('#authBack');                                        // cancelling returns to the same result screen
      await expect(page.locator('#overScreen')).toBeVisible();
    }

    // "Main menu" → the Introduction again, now with the guest player card and a Play button
    await page.locator('#homeBtn').scrollIntoViewIfNeeded();
    await backToIntro(page);
    await page.waitForTimeout(300);
    expect(await noHorizontalScroll(page)).toBe(true);
    expect(await inViewport(page, '#introPlay'), '#introPlay inside the viewport').toBe(true);
    expect(await inColumn(page, '#introPlay'), 'Play stays in the centred column').toBe(true);
    await expect(page.locator('.player-card')).toBeVisible();
    expect(await inColumn(page, '.player-card'), 'player card stays in the centred column').toBe(true);
    await page.screenshot({ path: `test-results/shots/${width}x${height}-7-menu.png` });
  });
}

test('rotating the phone: canvas re-scales without distortion; landscape phones are asked to turn upright', async ({ page }) => {
  await enterAsGuest(page);
  const ratio = () => page.evaluate(() => { const c = document.getElementById('game'); return [c.width / c.height, c.clientWidth / c.clientHeight, window.__ssc.game.sc]; });
  const aligned = async () => { const [x, y] = await ratio(); return Math.abs(x - y); };
  expect(await aligned()).toBeLessThan(0.01);
  await page.setViewportSize({ width: 844, height: 390 });                       // landscape phone
  await expect(page.locator('#rotate')).toBeVisible();
  await expect(page.locator('#rotate')).toContainText('Turn your phone upright');
  await expect.poll(aligned, { timeout: 5000 }).toBeLessThan(0.01);      // the canvas follows the new window size
  await page.setViewportSize({ width: 390, height: 844 });                       // back upright
  await expect(page.locator('#rotate')).toBeHidden();
  await expect.poll(aligned, { timeout: 5000 }).toBeLessThan(0.01);
  const [, , sc] = await ratio();
  expect(sc).toBeCloseTo(Math.min(390 / 400, 844 / 720), 5);
});

test('desktop keyboard play works and the page never scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterAsGuest(page);
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden');
  await waitForPlay(page);
  const x0 = await page.evaluate(() => window.__ssc.game.sim.target);
  await page.keyboard.down('a'); await page.waitForTimeout(400); await page.keyboard.up('a');
  expect(await page.evaluate(() => window.__ssc.game.sim.target)).toBeLessThan(x0);
});
