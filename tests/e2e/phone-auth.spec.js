// WhatsApp-OTP sign-in, registration (name · Croma region · phone), guest sign-in from the result screen.
//
// Real Supabase Phone Auth + the real registration RPC run here. The only thing replaced is WhatsApp delivery: the
// reserved test numbers have a fixed OTP for the duration of the run and the Send-SMS hook never messages them
// (see tests/e2e/global-setup.js). Needs SUPABASE_SERVICE_ROLE_KEY + SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { ANON_KEY, SERVICE_KEY, SUPABASE_URL, STORAGE_KEY, TEST_PHONES, OTP_CODE, PHONE_UI_READY, botFor, clickPlay, homeReady, injectSession, makeTestUser, deleteUsersByPhone, waitForResults } from './helpers.js';

test.skip(!SERVICE_KEY || !process.env.SUPABASE_ACCESS_TOKEN, 'set SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF to run the phone-OTP tests');
test.describe.configure({ mode: 'serial' });

const admin = SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const REGIONS = ['Croma East Region', 'Croma South Region', 'Croma North Region', 'Croma West Region'];
const [P_FORM, P_NEW, P_CHANGE, P_PLAY, P_RETURN, P_GUEST, P_MISC, P_NAV] = TEST_PHONES;     // one reserved number per scenario (Supabase allows one code per number per 60 s)

test.beforeAll(async () => { await deleteUsersByPhone(...TEST_PHONES); });
test.afterAll(async () => { await deleteUsersByPhone(...TEST_PHONES); });

const toEntry = async (page) => { await page.goto('/'); await page.waitForSelector('#introScreen', { timeout: 25_000 }); await page.click('#introContinue'); await page.waitForSelector('#entrySheet'); };
const openForm = async (page) => { await toEntry(page); await page.click('#signInBtn'); await page.waitForSelector('#authSheet #regForm'); };
const fill = async (page, { name, region, phone }) => {
  if (name != null) await page.fill('#regName', name);
  if (region != null) await page.selectOption('#regRegion', region);
  if (phone != null) await page.fill('#regPhone', phone);
};
const sendOtp = async (page, details) => { await fill(page, details); await page.click('#regSubmit'); await page.waitForSelector('#otpForm'); };
const enterCode = async (page, code = OTP_CODE()) => { await page.fill('#otpInput', code); };
const profileOf = async (phone10) => (await admin.from('profiles').select('*').eq('phone', '+91' + phone10).maybeSingle()).data;
const authUsersWithPhone = async (phone10) => ((await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users || []).filter((u) => u.phone === '91' + phone10);
const play = async (page, ms = 7500) => {
  await page.waitForFunction(() => window.__ssc.game.state === 'menu');
  await clickPlay(page);
  await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 25_000 });
  await botFor(page, ms);
  await page.evaluate(() => window.__ssc.game.quit());
  await waitForResults(page);
};

test('the setup is ready (test OTP numbers are active)', () => { expect(PHONE_UI_READY()).toBe(true); });

test('Entry Mode offers "Sign In with OTP" and "Play as Guest" — Google is gone from the player app', async ({ page }) => {
  await toEntry(page);
  await expect(page.locator('#signInBtn')).toHaveText('Sign In with OTP');
  await expect(page.locator('#guestBtn')).toBeVisible();
  await expect(page.locator('#googleBtn')).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/google/i);
  const html = await page.content();
  expect(html).not.toMatch(/accounts\.google|signInWithOAuth/i);
});

test('registration form: three required fields, exactly the four Croma regions, strict validation, nothing sent until valid', async ({ page }) => {
  const otpCalls = [];
  page.on('request', (r) => { if (/\/auth\/v1\/otp/.test(r.url())) otpCalls.push(r.url()); });
  await openForm(page);
  await expect(page.locator('#authTitle')).toContainText('Join the');
  await expect(page.locator('#regForm label.rfield')).toHaveCount(3);
  await expect(page.locator('#regForm label.rfield .rlbl')).toHaveText(['Full name', 'Store / Region', 'WhatsApp mobile number']);
  await expect(page.locator('#regRegion option')).toHaveText(['Select your Croma region', ...REGIONS]);       // exactly four, in order
  await expect(page.locator('.cc')).toContainText('+91');
  await expect(page.locator('#regSubmit')).toHaveText('Send OTP');

  await page.click('#regSubmit');
  await expect(page.locator('#regErr')).toContainText('full name');
  await fill(page, { name: '  ' });
  await page.click('#regSubmit'); await expect(page.locator('#regErr')).toContainText('full name');
  await fill(page, { name: 'A' });
  await page.click('#regSubmit'); await expect(page.locator('#regErr')).toContainText('full name');
  await fill(page, { name: '12345' });
  await page.click('#regSubmit'); await expect(page.locator('#regErr')).toContainText('real name');
  await fill(page, { name: '  Priya   Nair  ' });
  await page.click('#regSubmit'); await expect(page.locator('#regErr')).toContainText('Croma store region');
  await fill(page, { region: 'Croma North Region' });
  for (const bad of ['', '12345', '5876543210', '98765', '1234567890123', 'abcdefghij', '9999999999']) {
    await page.fill('#regPhone', bad);
    await page.click('#regSubmit');
    await expect(page.locator('#regErr'), `phone "${bad}"`).toContainText('valid 10-digit Indian mobile');
  }
  await page.fill('#regPhone', '+91 98765 43210');                                        // pasted with country code → just the 10 digits
  await expect(page.locator('#regPhone')).toHaveValue('9876543210');
  await page.fill('#regPhone', '09876543210');
  expect(otpCalls).toEqual([]);                                                          // nothing was sent while the form was invalid
  await expect(page.locator('#regName')).toHaveValue('  Priya   Nair  ');                // (trimmed only when submitted)
});

test('new player: OTP sent → wrong code rejected → right code registers, creates the profile ONLY now, lands on Game Home', async ({ page }) => {
  await openForm(page);
  await sendOtp(page, { name: ' Neha   Kapoor ', region: 'Croma East Region', phone: P_NEW });
  await expect(page.locator('#authTitle')).toContainText('WhatsApp');
  await expect(page.locator('#otpTo')).toHaveText('+91 60000 01011');
  await expect(page.locator('#otpResend')).toBeDisabled();
  await expect(page.locator('#otpResend')).toContainText('Resend OTP in');                // cooldown running
  await expect(page.locator('#otpSubmit')).toHaveText('Verify OTP');
  await expect(page.locator('.otp-cells span')).toHaveCount(6);

  // before verification: an unconfirmed auth record may exist, but NO player profile
  expect(await profileOf(P_NEW)).toBeNull();

  await page.fill('#otpInput', '000000');                                                 // wrong code
  await expect(page.locator('#otpErr')).toContainText("isn't right");
  await expect(page.locator('.otp-box')).toHaveClass(/bad/);
  expect(await profileOf(P_NEW)).toBeNull();
  await expect(page.locator('#startScreen')).toHaveCount(0);                              // no access without a valid session

  await enterCode(page);                                                                  // right code
  await page.waitForSelector('#startScreen', { timeout: 20_000 });
  await expect(page.locator('#authSheet')).toHaveCount(0);
  await expect(page.locator('#playerName')).toHaveText('Neha Kapoor');
  await expect(page.locator('#leaderBtn')).toBeVisible();                                 // leaderboard enabled
  const p = await profileOf(P_NEW);
  expect(p).toMatchObject({ display_name: 'Neha Kapoor', region: 'Croma East Region', phone: '+91' + P_NEW, auth_provider: 'phone', verified: true, email: null });
  expect(p.registered_at).toBeTruthy(); expect(p.updated_at).toBeTruthy();
  expect(await page.evaluate((k) => !!localStorage.getItem(k), STORAGE_KEY)).toBe(true);   // session stored
});

test('Change number, resend cooldown and a friendly rate-limit message', async ({ page }) => {
  await openForm(page);
  await sendOtp(page, { name: 'Ravi Shankar', region: 'Croma South Region', phone: P_CHANGE });
  await page.click('#otpChange');                                                         // back to the form with everything still filled in
  await expect(page.locator('#regForm')).toBeVisible();
  await expect(page.locator('#regName')).toHaveValue('Ravi Shankar');
  await expect(page.locator('#regRegion')).toHaveValue('Croma South Region');
  await expect(page.locator('#regPhone')).toHaveValue(P_CHANGE);
  await page.click('#regSubmit');                                                         // asking again straight away hits the 60 s limit
  await expect(page.locator('#regErr')).toContainText(/wait \d+ seconds/);
  await expect(page.locator('#otpForm')).toHaveCount(0);
});

test('delivery failures, offline and expired codes show clear messages (no raw errors)', async ({ page }) => {
  await openForm(page);
  await fill(page, { name: 'Test Person', region: 'Croma West Region', phone: P_MISC });
  await page.route('**/auth/v1/otp*', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 500, error_code: 'hook_failed', msg: 'Error sending sms' }) }));
  await page.click('#regSubmit');
  await expect(page.locator('#regErr')).toContainText("couldn't send the WhatsApp code");
  expect(await page.locator('#regErr').innerText()).not.toMatch(/hook|sms/i);
  await page.unroute('**/auth/v1/otp*');
  await page.route('**/auth/v1/otp*', (r) => r.abort('connectionreset'));
  await page.click('#regSubmit');
  await expect(page.locator('#regErr')).toContainText("Can't reach the server");
  await page.unroute('**/auth/v1/otp*');
  await page.route('**/auth/v1/otp*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));        // delivery "works"
  await page.click('#regSubmit');
  await page.waitForSelector('#otpForm');
  await page.route('**/auth/v1/verify*', (r) => r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }) }));
  await page.fill('#otpInput', '123456');
  await expect(page.locator('#otpErr')).toContainText('expired');
  await expect(page.locator('#otpInput')).toHaveValue('');                                // cleared so a new code can be typed
  await page.unroute('**/auth/v1/verify*');
  await page.route('**/auth/v1/verify*', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ code: 429, error_code: 'over_request_rate_limit', msg: 'rate limit' }) }));
  await page.fill('#otpInput', '654321');
  await expect(page.locator('#otpErr')).toContainText('Too many tries');
  expect(await profileOf(P_MISC)).toBeNull();                                             // nothing registered along the way
});

test('verified player plays: games are saved with their Croma region; no Sign In button on their results', async ({ page }) => {
  await openForm(page);
  await sendOtp(page, { name: 'Anita Desai', region: 'Croma North Region', phone: P_PLAY });
  await enterCode(page);
  await homeReady(page);
  await play(page);
  await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });
  await expect(page.locator('#resultSignInBtn')).toHaveCount(0);
  await expect(page.locator('#resultLeaderBtn')).toBeVisible();
  const p = await profileOf(P_PLAY);
  const games = (await admin.from('games').select('region, score, flagged, player_id').eq('player_id', p.id)).data;
  expect(games).toHaveLength(1);
  expect(games[0].region).toBe('Croma North Region');
  expect(games[0].flagged).toBe(false);
  const sessions = (await admin.from('game_sessions').select('region').eq('player_id', p.id)).data;
  expect(sessions.every((s) => s.region === 'Croma North Region')).toBe(true);
  expect(p.best_score).toBe(games[0].score);
});

test('returning player (new device / expired session): same phone + OTP restores the account — nothing overwritten, no duplicate', async ({ page }) => {
  // an existing registered player with a saved best score
  const existing = await makeTestUser('returning', 'Original Name', { phone: P_RETURN, region: 'Croma South Region' });
  await admin.from('profiles').update({ best_score: 777, best_at: new Date().toISOString(), games_played: 4, total_score: 2000 }).eq('id', existing.id);
  try {
    await openForm(page);                                                                  // no session in this browser
    await sendOtp(page, { name: 'Totally Different', region: 'Croma West Region', phone: P_RETURN });   // typed something else on purpose
    await enterCode(page);
    await homeReady(page);
    await expect(page.locator('#playerName')).toHaveText('Original Name');                  // existing name wins
    await expect(page.locator('#menuBest')).toHaveText('777');                              // saved best restored from Supabase
    await expect(page.locator('.toast')).toContainText('Welcome back, Original');
    const p = await profileOf(P_RETURN);
    expect(p).toMatchObject({ id: existing.id, display_name: 'Original Name', region: 'Croma South Region', best_score: 777, games_played: 4 });
    expect((await authUsersWithPhone(P_RETURN)).length).toBe(1);                            // no duplicate account
    expect(((await admin.from('profiles').select('id').eq('phone', '+91' + P_RETURN)).data || []).length).toBe(1);
  } finally { await existing.cleanup(); }
});

test('GUEST result screen: "Sign In with OTP" — cancel restores the result, play again stays guest, signing in never saves the guest round', async ({ page }) => {
  const calls = [];
  page.on('request', (r) => { if (/functions\/v1\/(start|finish)-game/.test(r.url())) calls.push(new URL(r.url()).pathname.split('/').pop()); });
  await toEntry(page);
  await page.click('#guestBtn');
  await homeReady(page);
  await expect(page.locator('#leaderBtn')).toHaveCount(0);
  await play(page);
  const score = await page.locator('#finalScore').textContent();
  expect(Number(score)).toBeGreaterThan(0);

  // result screen: existing elements preserved + the new action and message, still no leaderboard
  await expect(page.locator('#stCaught')).toBeVisible(); await expect(page.locator('#stTime')).toBeVisible(); await expect(page.locator('#stBest')).toHaveText(score);
  await expect(page.locator('#againBtn')).toBeVisible();
  await expect(page.locator('#resultSignInBtn')).toHaveText('Sign In with OTP');
  await expect(page.locator('#overScreen')).toContainText('Want to save your future scores and climb the leaderboard? Sign in to compete!');
  await expect(page.locator('#resultLeaderBtn')).toHaveCount(0);
  expect(await page.locator('#overScreen').innerText()).not.toMatch(/will be saved|we.ll save this/i);   // no promise about the current score

  // open the shared registration form, then cancel: the same guest result is restored
  await page.click('#resultSignInBtn');
  await expect(page.locator('#authSheet #regForm')).toBeVisible();
  await page.click('#authBack');
  await expect(page.locator('#authSheet')).toHaveCount(0);
  await expect(page.locator('#finalScore')).toHaveText(score);
  // …and from the OTP step, going back returns to the form first, then back again to the result
  await page.click('#resultSignInBtn');
  await sendOtp(page, { name: 'Guest Turned Player', region: 'Croma East Region', phone: P_NAV });
  await page.click('#authBack');                                                          // OTP step → form
  await expect(page.locator('#regForm')).toBeVisible();
  await page.click('#authBack');                                                          // form → result
  await expect(page.locator('#finalScore')).toHaveText(score);

  // Play Again continues as a guest, exactly as before
  await page.click('#againBtn');
  await page.waitForFunction(() => window.__ssc.game.state === 'play', null, { timeout: 15_000 });
  await botFor(page, 2500);
  await page.evaluate(() => window.__ssc.game.quit());
  await waitForResults(page);
  expect(calls).toEqual([]);                                                              // guest rounds never touched start-game / finish-game
  expect(await profileOf(P_GUEST)).toBeNull();

  // now actually sign in from the result screen
  await page.click('#resultSignInBtn');
  await sendOtp(page, { name: 'Guest Turned Player', region: 'Croma East Region', phone: P_GUEST });
  await enterCode(page);
  await page.waitForSelector('#startScreen', { timeout: 20_000 });
  await expect(page.locator('#playerName')).toHaveText('Guest Turned Player');
  await expect(page.locator('#leaderBtn')).toBeVisible();                                 // leaderboard now enabled
  await expect(page.locator('#menuBest')).toHaveText('0');                                // the guest score did NOT carry over
  const p = await profileOf(P_GUEST);
  expect(p).toMatchObject({ display_name: 'Guest Turned Player', region: 'Croma East Region', best_score: 0, games_played: 0 });
  expect((await admin.from('games').select('id').eq('player_id', p.id)).data).toEqual([]);                   // no game record from the guest round
  expect((await admin.from('game_sessions').select('id').eq('player_id', p.id)).data).toEqual([]);           // no session either
  expect(calls).toEqual([]);                                                              // still nothing sent to the game backend

  // only NEW games are saved
  await play(page);
  await expect(page.locator('#result')).toContainText('Your best:', { timeout: 20_000 });
  expect(calls).toEqual(['start-game', 'finish-game']);
  expect((await admin.from('games').select('region').eq('player_id', p.id)).data).toEqual([{ region: 'Croma East Region' }]);
  await expect(page.locator('#resultSignInBtn')).toHaveCount(0);
});

test('guest can also sign in from Game Home ("Playing as Guest · Sign in")', async ({ page }) => {
  await toEntry(page);
  await page.click('#guestBtn'); await homeReady(page);
  await expect(page.locator('#playerChip')).toContainText('Sign in');
  await page.click('#playerChip');
  await expect(page.locator('#authSheet #regForm')).toBeVisible();
  await page.click('#authBack');
  await expect(page.locator('#startScreen')).toBeVisible();                              // cancelled: still a guest on Game Home
  await expect(page.locator('#leaderBtn')).toHaveCount(0);
});

test('verified number but registration never finished: only name + region are asked; cancelling signs out', async ({ page, context }) => {
  const u = await makeTestUser('unreg', 'x', { kind: 'unregistered' });
  try {
    await injectSession(context, u.session);
    await page.goto('/');
    await page.waitForSelector('#authSheet', { timeout: 25_000 });
    await expect(page.locator('#authTitle')).toContainText('Almost');
    await expect(page.locator('#regPhone')).toHaveCount(0);
    await expect(page.locator('#regSubmit')).toHaveText('Continue');
    await expect(page.locator('#regForm')).toContainText('Your number is verified');
    expect((await admin.from('profiles').select('id').eq('id', u.id).maybeSingle()).data).toBeNull();
    await page.click('#authBack');                                                       // cancel → the half-made session is discarded
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBeNull();
    await expect(page.locator('#authSheet')).toHaveCount(0);
    await expect(page.locator('#introScreen')).toBeVisible();
  } finally { await u.cleanup(); }

  const u2 = await makeTestUser('unreg2', 'x', { kind: 'unregistered' });
  try {
    const ctx2 = await page.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await injectSession(ctx2, u2.session);
    const p2 = await ctx2.newPage();
    await p2.goto('/');
    await p2.waitForSelector('#authSheet', { timeout: 25_000 });
    await p2.click('#regSubmit');
    await expect(p2.locator('#regErr')).toContainText('full name');
    await p2.fill('#regName', 'Late Registrant');
    await p2.selectOption('#regRegion', 'Croma West Region');
    await p2.click('#regSubmit');
    await p2.waitForSelector('#startScreen', { timeout: 20_000 });
    await expect(p2.locator('#playerName')).toHaveText('Late Registrant');
    const prof = (await admin.from('profiles').select('display_name, region, phone').eq('id', u2.id).single()).data;
    expect(prof).toEqual({ display_name: 'Late Registrant', region: 'Croma West Region', phone: u2.phone });
    await ctx2.close();
  } finally { await u2.cleanup(); }
});
