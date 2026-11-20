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
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name, email_verified: true } });
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
  check('profile row auto-created for a new Auth user', prof?.display_name === 'Priya Test Sharma' && prof.email_verified === true, JSON.stringify(prof));
  const { data: tp, error: tpErr } = await p.client.rpc('touch_profile');
  check('touch_profile works for a signed-in user', !tpErr && tp?.best === 0 && tp?.rank == null, JSON.stringify(tpErr || tp));

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
  check('an honest real-time game is not flagged and is ranked #1', fin.j.flagged === false && fin.j.best === game.score && fin.j.rank === 1, JSON.stringify(fin));
  const { data: g1 } = await admin.from('games').select('score, client_score, flagged, flag_reason').eq('session_id', st.j.sessionId).single();
  check('the claimed (false) score is kept for audit only', g1.client_score === lie && /client_mismatch/.test(g1.flag_reason || ''), JSON.stringify(g1));

  // 2) retry the same session → no duplicate record
  const again = await fn('finish-game', p.token, { sessionId: st.j.sessionId, inputs: game.inputs, endTick: game.endTick, clientScore: game.score });
  check('retrying finish-game is safe (returns stored result, flagged duplicate)', again.status === 200 && again.j.duplicate === true && again.j.score === game.score && again.j.rank === 1, JSON.stringify(again));
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
  check('short name is "First L." and own rank is shown', lb.me?.name === 'Priya S.' && lb.me?.rank === 1 && lb.me?.best === game.score, JSON.stringify(lb.me));
  check('rank & best come only from validated, unflagged scores', me0.best === game.score && me0.rank === 1, JSON.stringify(me0));

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
  check('admin CSV export works and has a header row', csv.status === 200 && /^﻿?id,/.test(csv.text), csv.text.slice(0, 80));
  check('CSV export does not include private notes / user agents', !/,notes|user_agent/.test(csv.text.split('\n')[0]));
  const dq = await fn('admin', p.token, { id: other.id, value: true }, { qs: '?action=disqualify' });
  check('admin can disqualify a player', dq.status === 200 && dq.j.disqualified === true, JSON.stringify(dq));
  await fn('admin', p.token, { id: other.id, value: false }, { qs: '?action=disqualify' });
  check('admin API rejects unknown actions (400)', (await fn('admin', p.token, null, { method: 'GET', qs: '?action=nope' })).status === 400);
  const h = await fn('admin', p.token, null, { method: 'GET', qs: '?action=health' });
  check('admin health reports email provider status without secrets', h.status === 200 && !/key|pass/i.test(JSON.stringify(h.j)), JSON.stringify(h));
} catch (e) {
  fail++; console.error('FATAL', e);
} finally {
  for (const id of users) await admin.auth.admin.deleteUser(id);
  await admin.from('admin_users').delete().like('email', 'ssc-test-%');
  console.log(`\n${pass} passed, ${fail} failed (temporary users removed)`);
  process.exit(fail ? 1 : 0);
}
