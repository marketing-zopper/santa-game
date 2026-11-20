// Admin dashboard: Google sign-in + server-side allow-list (public.admin_users). Needs SUPABASE_SERVICE_ROLE_KEY.
import { test, expect } from '@playwright/test';
import { injectSession, makeTestUser, SERVICE_KEY } from './helpers.js';

test.skip(!SERVICE_KEY, 'set SUPABASE_SERVICE_ROLE_KEY to run the admin tests');
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.describe.configure({ mode: 'serial' });

let user;
test.beforeAll(async () => {
  user = await makeTestUser('admin', 'E2E Admin Person');
  // give them one finished game so the tables have data
  const { data: s } = await user.admin.from('game_sessions').insert({ player_id: user.id, seed: 4242 }).select('id').single();
  await user.admin.from('games').insert({ player_id: user.id, session_id: s.id, score: 321, client_score: 321, duration_s: 20, phones_caught: 9, flagged: false });
  await user.admin.from('profiles').update({ best_score: 321, best_at: new Date().toISOString(), games_played: 1, total_score: 321, email_verified: true, city: 'Mumbai', location_source: 'gps', lat: 19.07, lng: 72.87 }).eq('id', user.id);
});
test.afterAll(async () => { if (user) await user.cleanup(); });

test('signed-out visitor sees only the Google sign-in card (no password box)', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('.login-card h1')).toContainText('Admin');
  await expect(page.getByRole('button', { name: /sign in with google/i })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.locator('#appView')).toHaveCount(0);
});

test('a signed-in player who is not an admin is refused', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/admin');
  await expect(page.locator('.login-card h1')).toHaveText('No admin access', { timeout: 20_000 });
  await expect(page.locator('#appView')).toHaveCount(0);
});

test('allow-listed admin: KPIs, charts, tabs, search, per-player games, CSV export, disqualify / reinstate', async ({ page, context }) => {
  await user.admin.from('admin_users').insert({ email: user.email });
  await injectSession(context, user.session);
  await page.goto('/admin');
  await expect(page.locator('#appView')).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('.kpi')).toHaveCount(7);
  await expect(page.locator('.chart svg')).toHaveCount(2);
  await expect(page.locator('.cities li').first()).toBeVisible();

  // leaderboard tab lists the player with their prize rank and city
  await page.fill('input[type=search]', 'E2E Admin');
  const row = page.locator('tbody tr', { hasText: 'E2E Admin Person' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('321');
  await expect(row).toContainText('Mumbai');
  await expect(row).toContainText('Verified');

  // search finds by email; wildcard characters are not treated as wildcards
  await page.fill('input[type=search]', '%');
  await expect(page.locator('tbody tr td.empty')).toBeVisible();
  await page.fill('input[type=search]', user.email.split('@')[0]);
  await expect(row).toHaveCount(1);

  // players + games tabs
  await page.getByRole('tab', { name: 'All players' }).click();
  await expect(page.locator('th', { hasText: 'Thank-you email' })).toBeVisible();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Games' }).click();
  await expect(page.locator('#appView')).toContainText('Showing games for');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('OK');
  await page.getByRole('button', { name: 'Show all' }).click();

  // CSV export downloads a file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^santa-safe-catch-games-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0].split(',');
  expect(header.slice(0, 5)).toEqual(['created_at', 'display_name', 'email', 'score', 'client_score']);   // readable column order, not alphabetical
  expect(header).not.toContain('notes');

  // disqualify needs a second tap, then reinstate
  await page.getByRole('tab', { name: 'All players' }).click();
  await page.fill('input[type=search]', 'E2E Admin');
  const btn = row.getByRole('button', { name: 'Disqualify' });
  await btn.click();
  await expect(row.getByRole('button', { name: 'Tap again to confirm' })).toBeVisible();
  await row.getByRole('button', { name: 'Tap again to confirm' }).click();
  await expect(row).toHaveClass(/dq/);
  await row.getByRole('button', { name: 'Reinstate' }).click();
  await expect(row).not.toHaveClass(/dq/);
});
