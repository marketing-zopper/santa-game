// End-to-end check of the live Supabase backend (RLS, Edge Functions, score validation, admin authorisation).
//
//   SUPABASE_URL=...  SUPABASE_ANON_KEY=...  SUPABASE_SERVICE_ROLE_KEY=...  node scripts/verify-backend.mjs
//
// The service-role key is only read from the environment (never commit it). The script creates two temporary
// Auth users, exercises the API as a guest / player / non-admin / admin, and deletes the users again.
import { createClient } from '@supabase/supabase-js';
import { Sim, CFG } from '../supabase/functions/_shared/engine.js';

const { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE } = process.env;
if (!URL_ || !ANON || !SERVICE) { console.error('Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVICE, opts);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); };

async function fn(name, token, body, { method = 'POST', qs = '' } = {}) {
  const r = await fetch(`${URL_}/functions/v1/${name}${qs}`, {
    method, headers: { 'Content-Type': 'application/json', apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* csv etc. */ }
  return { status: r.status, j, text };
}

/** Play a game with a bot that never moves, recording inputs exactly as the game does. Returns what the client would send. */
function botGame(seed, moveTo) {
  const sim = new Sim(seed); const inputs = []; let last = null;
  while (!sim.over && sim.tick < 60 * 60) {
    if (moveTo) sim.setTarget(moveTo(sim));
    sim.target = Math.round(sim.target * 4) / 4;
    if (sim.target !== last) { inputs.push(sim.tick + 1, sim.target); last = sim.target; }
    sim.step();
  }
  return { inputs, endTick: sim.tick, score: sim.score, caught: sim.caught, t: sim.t };
}
/** A smarter bot (same idea as the attract-mode demo) so we get a non-zero score. */
const catcher = (sim) => {
  const c = sim.c; let tgt = sim.target;
  const goods = sim.items.filter((i) => i.type !== 'coal' && i.y < c.CATCH_Y).map((i) => ({ i, tau: (c.CATCH_Y - i.y) / i.vy })).sort((a, b) => a.tau - b.tau);
  let pos = sim.x, pt = 0, first = null;
  for (const g of goods) if (Math.abs(g.i.x - pos) <= c.SLEIGH_SPEED * 0.7 * (g.tau - pt) + 20) { if (first == null) first = g.i.x; pos = g.i.x; pt = g.tau; }
  return first != null ? first : tgt;
};

const stamp = Date.now().toString(36);
const users = [];
async function makeUser(label, name) {
  const email = `ssc-test-${label}-${stamp}@example.test`, password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { provider: 'google', providers: ['google'] }, user_metadata: { full_name: name, email_verified: true } });
  if (error) throw error;
  users.push(data.user.id);
  const c = createClient(URL_, ANON, opts);
  const { data: s, error: e2 } = await c.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, client: c, token: s.session.access_token };
}

try {
  // ---------- guests (no login) ----------
  const guest = createClient(URL_, ANON, opts);
  for (const t of ['profiles', 'games', 'game_sessions', 'admin_users', 'email_log']) {
    const { error } = await guest.from(t).select('*').limit(1);
    check(`guest cannot read ${t}`, !!error, 'read succeeded');
  }
  check('guest cannot call get_leaderboard', !!(await guest.rpc('get_leaderboard')).error);
  check('guest cannot call touch_profile', !!(await guest.rpc('touch_profile')).error);
  check('guest cannot insert a profile', !!(await guest.from('profiles').insert({ id: crypto.randomUUID() })).error);
  check('start-game rejects a request with no token', (await fn('start-game', null, {})).status === 401);
  check('start-game rejects the publishable key as a token', (await fn('start-game', ANON, {})).status === 401);
  check('finish-game rejects a request with no token', (await fn('finish-game', null, {})).status === 401);
  check('admin rejects a request with no token', (await fn('admin', null, null, { method: 'GET', qs: '?action=stats' })).status === 401);

  // ---------- signed-in player ----------
  const p = await makeUser('player', 'Priya Test Sharma');
  const { data: prof } = await admin.from('profiles').select('*').eq('id', p.id).single();
  check('profile row auto-created for a new Auth user', prof?.display_name === 'Priya Test Sharma', JSON.stringify(prof));
  const { data: tp, error: tpErr } = await p.client.rpc('touch_profile');
  check('touch_profile works for a signed-in user and marks a Google identity verified', !tpErr && tp?.best === 0 && tp?.rank == null && tp?.verified === true, JSON.stringify(tpErr || tp));

  const own = await p.client.from('profiles').select('id,best_score').eq('id', p.id);
  check('player can read their own profile', own.data?.length === 1);
  check('player cannot read the restricted columns (notes / disqualified)', !!(await p.client.from('profiles').select('notes').eq('id', p.id)).error);
  check('player cannot UPDATE their own best_score', !!(await p.client.from('profiles').update({ best_score: 999999 }).eq('id', p.id)).error || (await admin.from('profiles').select('best_score').eq('id', p.id).single()).data.best_score === 0);
  check('player cannot INSERT a game', !!(await p.client.from('games').insert({ player_id: p.id, session_id: crypto.randomUUID(), score: 99999 })).error);
  check('player cannot read game_sessions', !!(await p.client.from('game_sessions').select('*').limit(1)).error);

  // start + finish a genuine game: the bot plays well for ~6 s, then stops (so the game ends in ~10 s and we can
  // wait out its real duration — the server rejects games that finish faster than real time)
  const st = await fn('start-game', p.token, {});
  check('start-game returns a session + server seed', st.status === 200 && typeof st.j?.sessionId === 'string' && Number.isInteger(st.j?.seed) && st.j.seed >= 1, JSON.stringify(st));
  const game = botGame(st.j.seed, (sim) => (sim.tick < 360 ? catcher(sim) : sim.target));
  check('the test bot scored something', game.score > 0, String(game.score));
  const wait = Math.max(0, game.t - 8 + 1);
  console.log(`      (waiting ${wait.toFixed(1)}s so the honest game is not "faster than real time")`);
  await sleep(wait * 1000);

  // 1) tampered claim: the client lies about its score → the server keeps its own number
  const lie = game.score + 5000;
  const fin = await fn('finish-game', p.token, { sessionId: st.j.sessionId, inputs: game.inputs, endTick: game.endTick, clientScore: lie });
  check('finish-game saves the SERVER-computed score, not the claimed one', fin.status === 200 && fin.j.score === game.score, JSON.stringify(fin));
  // ranks are relative to whoever is already on the (live) board, so assert consistency instead of a fixed position
  const { count: higher } = await admin.from('profiles').select('id', { count: 'exact', head: true }).gt('best_score', game.score).eq('verified', true).eq('disqualified', false).neq('id', p.id);
  check('an honest real-time game is not flagged and is ranked correctly among the validated players', fin.j.flagged === false && fin.j.best === game.score && fin.j.rank >= higher + 1 && fin.j.rank <= fin.j.total, JSON.stringify(fin) + ' higher=' + higher);
  const { data: g1 } = await admin.from('games').select('score, client_score, flagged, flag_reason').eq('session_id', st.j.sessionId).single();
  check('the claimed (false) score is kept for audit only', g1.client_score === lie && /client_mismatch/.test(g1.flag_reason || ''), JSON.stringify(g1));

  // 2) retry the same session → no duplicate record
  const again = await fn('finish-game', p.token, { sessionId: st.j.sessionId, inputs: game.inputs, endTick: game.endTick, clientScore: game.score });
  check('retrying finish-game is safe (returns stored result, flagged duplicate)', again.status === 200 && again.j.duplicate === true && again.j.score === game.score && again.j.rank === fin.j.rank, JSON.stringify(again));
  const { count: n1 } = await admin.from('games').select('id', { count: 'exact', head: true }).eq('player_id', p.id);
  check('exactly one game row exists after the retry', n1 === 1, String(n1));

  // 3) a game "played" faster than real time is flagged and never counts towards best / rank
  const st2 = await fn('start-game', p.token, {});
  const instant = botGame(st2.j.seed, catcher);   // ~60 s of game time, submitted immediately
  const fin2 = await fn('finish-game', p.token, { sessionId: st2.j.sessionId, inputs: instant.inputs, endTick: instant.endTick, clientScore: instant.score });
  check('a faster-than-real-time game is flagged', fin2.status === 200 && fin2.j.flagged === true, JSON.stringify(fin2));
  check('a flagged game does not change the personal best', fin2.j.best === game.score, JSON.stringify(fin2));

  // 4) someone else cannot finish my session; garbage payloads rejected
  const other = await makeUser('other', 'Other Person');
  const st3 = await fn('start-game', p.token, {});
  const steal = await fn('finish-game', other.token, { sessionId: st3.j.sessionId, inputs: [], endTick: 10 });
  check("another user cannot finish my session (404)", steal.status === 404, JSON.stringify(steal));
  check('malformed inputs are rejected (400)', (await fn('finish-game', p.token, { sessionId: st3.j.sessionId, inputs: [5, 'x'] })).status === 400);
  check('unsorted inputs are rejected (400)', (await fn('finish-game', p.token, { sessionId: st3.j.sessionId, inputs: [9, 100, 3, 100] })).status === 400);
  check('missing session id is rejected (400)', (await fn('finish-game', p.token, { inputs: [] })).status === 400);

  // 5) rate limit
  let limited = false;
  for (let i = 0; i < 14 && !limited; i++) limited = (await fn('start-game', other.token, {})).status === 429;
  check('start-game is rate-limited (429 after 12 starts / minute)', limited);

  // ---------- leaderboard ----------
  // make the player ranked: give them a legit (unflagged) score by writing through the same server function path
  const { data: me0 } = await p.client.rpc('touch_profile');
  const { data: lb, error: lbErr } = await p.client.rpc('get_leaderboard', { p_limit: 10 });
  check('signed-in player can load the leaderboard', !lbErr && Array.isArray(lb?.top), JSON.stringify(lbErr));
  check('leaderboard exposes only rank / short name / score (no emails, ids, full names)',
    (lb?.top || []).every((r) => Object.keys(r).sort().join() === 'name,rank,score' && !/@/.test(r.name) && r.name.split(' ').length <= 2), JSON.stringify(lb));
  check('short name is "First L." and own rank is shown', lb.me?.name === 'Priya S.' && lb.me?.rank === fin.j.rank && lb.me?.best === game.score, JSON.stringify(lb.me));
  check('rank & best come only from validated, unflagged scores', me0.best === game.score && me0.rank === fin.j.rank, JSON.stringify(me0));

  // ---------- admin ----------
  const as = await fn('admin', p.token, null, { method: 'GET', qs: '?action=stats' });
  check('a non-admin player is refused by the admin API (403)', as.status === 403, JSON.stringify(as));
  await admin.from('admin_users').insert({ email: p.email.toLowerCase() });
  const stats = await fn('admin', p.token, null, { method: 'GET', qs: '?action=stats' });
  check('an allow-listed admin gets stats', stats.status === 200 && typeof stats.j?.players === 'number', JSON.stringify(stats));
  for (const k of ['leaderboard', 'players', 'games']) {
    const r = await fn('admin', p.token, null, { method: 'GET', qs: `?action=${k}&limit=5` });
    check(`admin list: ${k}`, r.status === 200 && Array.isArray(r.j?.rows), JSON.stringify(r).slice(0, 200));
  }
  const srch = await fn('admin', p.token, null, { method: 'GET', qs: '?action=players&q=' + encodeURIComponent('Priya%') });
  check('admin search escapes % / _ wildcards (no false matches)', srch.status === 200 && srch.j.total === 0, JSON.stringify(srch).slice(0, 200));
  const srch2 = await fn('admin', p.token, null, { method: 'GET', qs: '?action=players&q=priya' });
  check('admin search finds the player by name', srch2.status === 200 && srch2.j.total >= 1);
  const gl = await fn('admin', p.token, null, { method: 'GET', qs: `?action=games&player=${p.id}` });
  check('admin games list filters by player', gl.status === 200 && gl.j.rows.every((r) => r.player_id === p.id) && gl.j.total >= 1, JSON.stringify(gl).slice(0, 200));
  const csv = await fn('admin', p.token, null, { method: 'GET', qs: '?action=export&type=players' });
  check('admin CSV export works and has a readable header row', csv.status === 200 && /^display_name,phone,email,region,/.test(csv.text), csv.text.slice(0, 80));   // (fetch strips the UTF-8 BOM)
  check('CSV export does not include private notes / user agents', !/,notes|user_agent/.test(csv.text.split('\n')[0]));
  const dq = await fn('admin', p.token, { id: other.id, value: true }, { qs: '?action=disqualify' });
  check('admin can disqualify a player', dq.status === 200 && dq.j.disqualified === true, JSON.stringify(dq));
  await fn('admin', p.token, { id: other.id, value: false }, { qs: '?action=disqualify' });
  check('admin API rejects unknown actions (400)', (await fn('admin', p.token, null, { method: 'GET', qs: '?action=nope' })).status === 400);
  const h = await fn('admin', p.token, null, { method: 'GET', qs: '?action=health' });
  check('admin health reports email provider status without secrets', h.status === 200 && !/key|pass/i.test(JSON.stringify(h.j)), JSON.stringify(h));
  // ---------- WhatsApp-OTP (phone) players, Croma regions, admin region reporting ----------
  {
    const mkPhone = async () => {
      const num = '91' + String(6 + Math.floor(Math.random() * 4)) + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
      const password = `Pw-${stamp}-${Math.random().toString(36).slice(2)}!`;
      const { data, error } = await admin.auth.admin.createUser({ phone: num, phone_confirm: true, password });   // = a phone whose OTP was verified
      if (error) throw error; users.push(data.user.id);
      const c = createClient(URL_, ANON, opts);
      const { data: s, error: e2 } = await c.auth.signInWithPassword({ phone: '+' + num, password });
      if (e2) throw e2;
      return { id: data.user.id, e164: '+' + num, client: c, token: s.session.access_token };
    };
    const ph = await mkPhone();

    // no profile before registration
    const pre = await admin.from('profiles').select('id').eq('id', ph.id).maybeSingle();
    check('a verified phone number alone creates NO profile (registration comes first)', !pre.data, JSON.stringify(pre.data));
    const tp0 = await ph.client.rpc('touch_profile');
    check('touch_profile reports registered:false for an unregistered phone player', tp0.data?.registered === false && tp0.data?.phone === ph.e164, JSON.stringify(tp0));
    check('an unregistered phone player cannot start a game (403)', (await fn('start-game', ph.token, {})).status === 403);
    check('an unregistered phone player gets no leaderboard data', !(await ph.client.rpc('get_leaderboard')).data);
    check('touch_profile still did not create a profile', !(await admin.from('profiles').select('id').eq('id', ph.id).maybeSingle()).data);

    // registration rules
    for (const [label, name, region, want] of [['an empty name', '  ', 'Croma East Region', /invalid_name/], ['a one-letter name', 'A', 'Croma East Region', /invalid_name/], ['a name with markup', '<b>Hi</b>', 'Croma East Region', /invalid_name/],
      ['a digits-only name', '12345', 'Croma East Region', /invalid_name/], ['an unknown region', 'Asha Verma', 'Croma Central Region', /invalid_region/], ['no region', 'Asha Verma', null, /invalid_region/]]) {
      const r = await ph.client.rpc('complete_registration', { p_name: name, p_region: region });
      check(`registration rejects ${label}`, !!r.error && want.test(r.error.message), JSON.stringify(r.error));
    }
    check('a Google (non-phone) account cannot use complete_registration', /phone_not_verified/.test((await p.client.rpc('complete_registration', { p_name: 'Priya X', p_region: 'Croma East Region' })).error?.message || ''));
    check('guests cannot call complete_registration', !!(await createClient(URL_, ANON, opts).rpc('complete_registration', { p_name: 'Asha Verma', p_region: 'Croma East Region' })).error);

    const reg = await ph.client.rpc('complete_registration', { p_name: '  Asha   Verma ', p_region: 'Croma South Region' });
    check('registration creates the profile (name tidied, region, phone from the verified record)', !reg.error && reg.data?.name === 'Asha Verma' && reg.data?.region === 'Croma South Region' && reg.data?.phone === ph.e164 && reg.data?.existing === false && reg.data?.auth_provider === 'phone' && reg.data?.verified === true, JSON.stringify(reg));
    const row = (await admin.from('profiles').select('*').eq('id', ph.id).single()).data;
    check('profile row: phone, region, provider, verified, timestamps', row.phone === ph.e164 && row.region === 'Croma South Region' && row.auth_provider === 'phone' && row.verified === true && !!row.registered_at && !!row.updated_at && !row.email, JSON.stringify(row));
    const again = await ph.client.rpc('complete_registration', { p_name: 'Someone Else', p_region: 'Croma West Region' });
    check('a returning player is restored and NOTHING is overwritten (name / region kept)', again.data?.existing === true && again.data?.name === 'Asha Verma' && again.data?.region === 'Croma South Region', JSON.stringify(again.data));
    check('still exactly one profile for this account', (await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('id', ph.id)).count === 1);
    const upd = await ph.client.from('profiles').update({ region: 'Croma East Region' }).eq('id', ph.id);
    check('a player cannot change their own region or phone (no write access)', !!upd.error || (await admin.from('profiles').select('region').eq('id', ph.id).single()).data.region === 'Croma South Region');
    check('a player CAN read their own phone and region (column grant)', (await ph.client.from('profiles').select('phone, region').eq('id', ph.id)).data?.[0]?.region === 'Croma South Region');
    const other = await admin.from('profiles').select('id').neq('id', ph.id).limit(1);
    check('a player cannot read other players\' phone numbers or regions (RLS)', ((await ph.client.from('profiles').select('phone, region').neq('id', ph.id)).data || []).length === 0);

    // database integrity
    check('the database refuses an unknown region (foreign key)', !!(await admin.from('profiles').update({ region: 'Mars' }).eq('id', ph.id)).error);
    check('the database refuses a malformed phone number', !!(await admin.from('profiles').update({ phone: '12345' }).eq('id', ph.id)).error);
    const ph2 = await mkPhone(); await ph2.client.rpc('complete_registration', { p_name: 'Second Person', p_region: 'Croma North Region' });
    check('two profiles cannot share a phone number (unique)', !!(await admin.from('profiles').update({ phone: ph.e164 }).eq('id', ph2.id)).error);
    check('regions table holds exactly the four Croma regions, in order',
      JSON.stringify((await admin.from('regions').select('name').order('sort_order')).data.map((r) => r.name)) === JSON.stringify(['Croma East Region', 'Croma South Region', 'Croma North Region', 'Croma West Region']));

    // authenticated play: region snapshot on session and game
    const sess = await fn('start-game', ph.token, {});
    check('a registered phone player can start a game', sess.status === 200 && typeof sess.j?.sessionId === 'string', JSON.stringify(sess));
    const sRow = (await admin.from('game_sessions').select('region').eq('id', sess.j.sessionId).single()).data;
    check('the game session carries the region snapshot', sRow.region === 'Croma South Region', JSON.stringify(sRow));
    const g2 = botGame(sess.j.seed, null);
    await sleep(Math.max(0, g2.t - 8 + 1) * 1000);
    const fin3 = await fn('finish-game', ph.token, { sessionId: sess.j.sessionId, inputs: g2.inputs, endTick: g2.endTick, clientScore: g2.score });
    check('a registered phone player\'s game is validated and saved', fin3.status === 200 && fin3.j.flagged === false && fin3.j.score === g2.score, JSON.stringify(fin3));
    const gRow = (await admin.from('games').select('region, player_id').eq('session_id', sess.j.sessionId).single()).data;
    check('the saved game carries the region snapshot and links to the player', gRow.region === 'Croma South Region' && gRow.player_id === ph.id, JSON.stringify(gRow));
    await admin.from('profiles').update({ region: 'Croma East Region' }).eq('id', ph.id);   // e.g. an admin correction
    check('changing a profile\'s region later does NOT rewrite the game\'s original region', (await admin.from('games').select('region').eq('session_id', sess.j.sessionId).single()).data.region === 'Croma South Region');
    await admin.from('profiles').update({ region: 'Croma South Region' }).eq('id', ph.id);

    // legacy Google players keep a NULL region (nothing invented)
    const legacy = (await admin.from('profiles').select('region, auth_provider').eq('id', p.id).single()).data;
    check('a Google (legacy) player has no region and is not given one', legacy.region === null && legacy.auth_provider === 'google', JSON.stringify(legacy));

    // admin: region filter, report, CSV
    const ad = (qs) => fn('admin', p.token, null, { method: 'GET', qs });
    const byReg = await ad('?action=players&region=' + encodeURIComponent('Croma South Region'));
    check('admin players filtered by region', byReg.status === 200 && byReg.j.rows.length >= 1 && byReg.j.rows.every((r) => r.region === 'Croma South Region') && byReg.j.rows.some((r) => r.id === ph.id), JSON.stringify(byReg).slice(0, 200));
    const leg = await ad('?action=players&region=legacy');
    check('admin "legacy" filter lists only players with no region (incl. Google test users)', leg.status === 200 && leg.j.rows.every((r) => r.region === null) && leg.j.rows.some((r) => r.id === p.id) && !leg.j.rows.some((r) => r.id === ph.id));
    check('admin games filtered by the SNAPSHOT region', (await ad('?action=games&region=' + encodeURIComponent('Croma South Region'))).j.rows.some((r) => r.player_id === ph.id));
    check('admin rejects an unknown region (400)', (await ad('?action=players&region=Mars')).status === 400);
    const byPhone = await ad('?action=players&q=' + encodeURIComponent(ph.e164.slice(3, 9)));
    check('admin can search players by phone number', byPhone.j.rows.some((r) => r.id === ph.id));
    const rep = await ad('?action=regions');
    const south = rep.j?.rows?.find((r) => r.region === 'Croma South Region');
    check('region report: 4 regions + legacy, with players / games / valid games / average / top score',
      rep.status === 200 && rep.j.rows.length === 5 && rep.j.rows.at(-1).region === 'Legacy / unknown' && south.players >= 1 && south.games >= 1 && south.valid_games >= 1 && typeof south.avg_score === 'number' && typeof south.top_score === 'number', JSON.stringify(rep).slice(0, 300));
    const stats2 = await ad('?action=stats');
    check('admin stats include the region report and phone / legacy player counts', Array.isArray(stats2.j.by_region) && stats2.j.phone_players >= 2 && stats2.j.legacy_players >= 1);
    const csvP = await ad('?action=export&type=players');
    check('players CSV has phone and region columns', /^display_name,phone,email,region,/.test(csvP.text), csvP.text.slice(0, 80));
    const csvG = await ad('?action=export&type=games');
    check('games CSV has phone and region (snapshot) columns', /^created_at,display_name,phone,email,region,/.test(csvG.text), csvG.text.slice(0, 80));
    const csvR = await ad('?action=export&type=regions');
    check('region report CSV export', /^region,players,games,valid_games,avg_score,top_score,best_player_score/.test(csvR.text) && /Croma South Region,/.test(csvR.text), csvR.text.slice(0, 120));
    check('a non-admin phone player cannot read the region report (403)', (await fn('admin', ph.token, null, { method: 'GET', qs: '?action=regions' })).status === 403);

    // OTP send cap used by the Auth Hook (5 per number per hour)
    const capPhone = '+9196' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const caps = []; for (let i = 0; i < 6; i++) caps.push((await admin.rpc('hook_allow_otp', { p_phone: capPhone, p_max_per_hour: 5 })).data);
    check('OTP send cap: five sends per number per hour, the sixth is refused', JSON.stringify(caps) === JSON.stringify([true, true, true, true, true, false]), JSON.stringify(caps));
    await admin.from('otp_sends').delete().eq('phone', capPhone);
    check('guests cannot call the OTP cap function or read the send log', !!(await createClient(URL_, ANON, opts).rpc('hook_allow_otp', { p_phone: capPhone })).error && !!(await createClient(URL_, ANON, opts).from('otp_sends').select('*')).error);
  }

  // ---------- accounts that did NOT come through Google (email/password) ----------
  {
    const email = `ssc-test-pw-${stamp}@example.test`, password = `Pw-${stamp}-x!`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Password Person', email_verified: true } });
    if (error) throw error; users.push(data.user.id);
    const c = createClient(URL_, ANON, opts); const { data: sess } = await c.auth.signInWithPassword({ email, password });
    const tok = sess.session.access_token;
    const tp = await c.rpc('touch_profile');
    check('a non-Google (email/password) account is never "verified"', tp.data?.verified === false, JSON.stringify(tp));
    const st = await fn('start-game', tok, {});
    check('a non-Google account cannot start a game (403)', st.status === 403, JSON.stringify(st));
    const lb2 = await c.rpc('get_leaderboard');
    check('a non-Google account gets no leaderboard data', !lb2.data, JSON.stringify(lb2.data));
    await admin.from('admin_users').insert({ email });
    const ad = await fn('admin', tok, null, { method: 'GET', qs: '?action=stats' });
    check('a non-Google account cannot use the admin API even if its email is allow-listed (403)', ad.status === 403, JSON.stringify(ad));
  }
} catch (e) {
  fail++; console.error('FATAL', e);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  await admin.from('admin_users').delete().like('email', 'ssc-test-%');
  console.log(`\n${pass} passed, ${fail} failed (temporary users removed)`);
  process.exit(fail ? 1 : 0);
}
