// Admin dashboard: Google sign-in + server-side allow-list (public.admin_users). Needs SUPABASE_SERVICE_ROLE_KEY.
import { test, expect } from '@playwright/test';
import { injectSession, makeTestUser, SERVICE_KEY } from './helpers.js';
import { REGIONS } from '../../src/lib/regions.js';

test.skip(!SERVICE_KEY, 'set SUPABASE_SERVICE_ROLE_KEY to run the admin tests');
test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 });
test.describe.configure({ mode: 'serial' });

let user, phoneUser;
test.beforeAll(async () => {
  // a phone player in the North region with one finished game, so the region views have something to show
  phoneUser = await makeTestUser('regionp', 'Region Player Kumar', { region: 'Croma North Region' });
  {
    const { data: s } = await phoneUser.admin.from('game_sessions').insert({ player_id: phoneUser.id, seed: 777, region: 'Croma North Region' }).select('id').single();
    await phoneUser.admin.from('games').insert({ player_id: phoneUser.id, session_id: s.id, score: 555, client_score: 555, duration_s: 30, phones_caught: 12, flagged: false, region: 'Croma North Region' });
    await phoneUser.admin.from('profiles').update({ best_score: 555, best_at: new Date().toISOString(), games_played: 1, total_score: 555 }).eq('id', phoneUser.id);
  }
  user = await makeTestUser('admin', 'E2E Admin Person', { kind: 'google' });
  // give them one finished game so the tables have data
  const { data: s } = await user.admin.from('game_sessions').insert({ player_id: user.id, seed: 4242 }).select('id').single();
  await user.admin.from('games').insert({ player_id: user.id, session_id: s.id, score: 321, client_score: 321, duration_s: 20, phones_caught: 9, flagged: false });
  await user.admin.from('profiles').update({ best_score: 321, best_at: new Date().toISOString(), games_played: 1, total_score: 321, verified: true, city: 'Mumbai', location_source: 'gps', lat: 19.07, lng: 72.87 }).eq('id', user.id);
});
test.afterAll(async () => { if (user) await user.cleanup(); if (phoneUser) await phoneUser.cleanup(); });

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
  const row = page.locator('#dataPanel tbody tr', { hasText: 'E2E Admin Person' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('321');
  await expect(row).toContainText('Mumbai');
  await expect(row).toContainText('Verified');

  // search finds by email; wildcard characters are not treated as wildcards
  await page.fill('input[type=search]', '%');
  await expect(page.locator('#dataPanel tbody tr td.empty')).toBeVisible();
  await page.fill('input[type=search]', user.email.split('@')[0]);
  await expect(row).toHaveCount(1);

  // players + games tabs
  await page.getByRole('tab', { name: 'All players' }).click();
  await expect(page.locator('th', { hasText: 'Thank-you email' })).toBeVisible();
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Games' }).click();
  await expect(page.locator('#appView')).toContainText('Showing games for');
  await expect(page.locator('#dataPanel tbody tr')).toHaveCount(1);
  await expect(page.locator('#dataPanel tbody tr')).toContainText('OK');
  await page.getByRole('button', { name: 'Show all' }).click();

  // CSV export downloads a file
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/^santa-safe-catch-games-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8');
  const header = csv.replace(/^﻿/, '').split(/\r?\n/)[0].split(',');
  expect(header.slice(0, 7)).toEqual(['created_at', 'display_name', 'phone', 'email', 'region', 'score', 'client_score']);   // phone + region (snapshot) are part of the export   // readable column order, not alphabetical
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

test('regions: report panel, region filter on every tab, phone + region columns, region-report CSV', async ({ page, context }) => {
  await injectSession(context, user.session);
  await page.goto('/admin');
  await expect(page.locator('#appView')).toBeVisible({ timeout: 25_000 });

  // region-wise performance: the four Croma regions (in order) + a legacy bucket
  const report = page.locator('#regionReport tbody tr');
  await expect(report).toHaveCount(5);
  await expect(report.locator('td:first-child')).toHaveText([...REGIONS, 'Legacy / unknown']);
  const north = page.locator('#regionReport tbody tr', { hasText: 'Croma North Region' });
  await expect(north.locator('td').nth(1)).not.toHaveText('0');                  // registered players ≥ 1
  await expect(north.locator('td').nth(2)).not.toHaveText('0');                  // total games ≥ 1
  await expect(north.locator('td').nth(5)).toHaveText(/555|[1-9]\d{2,}/);            // highest score
  await expect(page.locator('th', { hasText: 'Registered players' })).toBeVisible();
  for (const h of ['Total games', 'Valid games', 'Average score', 'Highest score']) await expect(page.locator('#regionReport th', { hasText: h })).toBeVisible();

  // filter: the region dropdown offers exactly All + four regions + Legacy
  await expect(page.locator('#regionFilter option')).toHaveText(['All regions', ...REGIONS, 'Legacy / unknown']);
  await page.getByRole('tab', { name: 'All players' }).click();
  await expect(page.locator('th', { hasText: 'Phone' })).toBeVisible();
  await expect(page.locator('th', { hasText: 'Region' }).first()).toBeVisible();
  await page.fill('input[type=search]', 'Region Player');
  const row = page.locator('#dataPanel tbody tr', { hasText: 'Region Player Kumar' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('+91 ');                                              // formatted phone
  await expect(row).toContainText('Croma North Region');
  await page.selectOption('#regionFilter', 'Croma South Region');
  await expect(page.locator('#dataPanel tbody tr td.empty')).toBeVisible();                       // not in South…
  await page.selectOption('#regionFilter', 'Croma North Region');
  await expect(row).toHaveCount(1);                                                         // …but in North
  await page.selectOption('#regionFilter', 'legacy');
  await expect(page.locator('#dataPanel tbody tr td.empty')).toBeVisible();                       // and not in Legacy
  await page.selectOption('#regionFilter', 'Croma North Region');
  await page.getByRole('tab', { name: 'Games' }).click();                          // Games use the region SNAPSHOT on each game
  await expect(page.locator('#dataPanel tbody tr', { hasText: 'Region Player Kumar' })).toContainText('Croma North Region');
  await page.fill('input[type=search]', '');
  await page.selectOption('#regionFilter', 'legacy');
  await expect(page.locator('#dataPanel tbody tr', { hasText: 'Region Player Kumar' })).toHaveCount(0);

  // legacy Google players are shown as "Legacy", never given a region
  await page.getByRole('tab', { name: 'All players' }).click();
  await page.fill('input[type=search]', 'E2E Admin');
  await expect(page.locator('#dataPanel tbody tr', { hasText: 'E2E Admin Person' }).locator('.pill', { hasText: 'Legacy' })).toBeVisible();

  // region-report CSV
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#exportRegions').click()]);
  expect(dl.suggestedFilename()).toMatch(/^santa-safe-catch-regions-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = (await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8')).replace(/^\uFEFF/, '');
  const lines = csv.split(/\r?\n/);
  expect(lines[0]).toBe('region,players,games,valid_games,avg_score,top_score,best_player_score');
  expect(lines.length).toBe(6);
  expect(lines[3]).toMatch(/^Croma North Region,[1-9]/);
});
