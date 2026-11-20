// Admin API for the /admin dashboard. Every call needs  Authorization: Bearer <Supabase access token>  of a signed-in
// Google account whose email is listed in public.admin_users. (Replaces the old shared "x-admin-key" password.)
//
//   GET  ?action=whoami
//   GET  ?action=stats
//   GET  ?action=leaderboard|players|games &q=&verified=all|yes|no &flagged=1 &player=<id> &limit=&offset=
//   GET  ?action=export&type=leaderboard|players|games          (CSV download, same filters)
//   GET  ?action=health                                          (which optional integrations are configured)
//   POST ?action=disqualify  { id, value: true|false }
//   POST ?action=test-email  { to }                              (sends a sample thank-you email)
import { handler, json, serviceClient, requireUser, readJson, HttpError, corsHeaders, isUuid } from '../_shared/common.js';
import { emailConfig, emailConfigured, sendEmail, thanksEmail } from '../_shared/email.js';

async function requireAdmin(req, db) {
  const user = await requireUser(req, db);
  const email = String(user.email || '').toLowerCase();
  const verified = !!(user.user_metadata?.email_verified ?? user.email_confirmed_at);
  if (!email || !verified) throw new HttpError(403, 'This account is not allowed to open the admin dashboard.');
  const { data, error } = await db.from('admin_users').select('email').eq('email', email).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(403, 'This account is not allowed to open the admin dashboard.');
  return { user, email };
}

function listArgs(u, all) {
  const limit = Math.min(500, Math.max(1, parseInt(u.searchParams.get('limit'), 10) || 50));
  const offset = Math.max(0, parseInt(u.searchParams.get('offset'), 10) || 0);
  const verified = ['yes', 'no'].includes(u.searchParams.get('verified')) ? u.searchParams.get('verified') : 'all';
  const pid = u.searchParams.get('player');
  return {
    p_q: (u.searchParams.get('q') || '').slice(0, 80), p_verified: verified,
    p_flagged: u.searchParams.get('flagged') === '1', p_player: pid && isUuid(pid) ? pid : null,
    p_limit: all ? null : limit, p_offset: all ? 0 : offset,
  };
}
async function list(db, kind, u, all) {
  const { data, error } = await db.rpc('admin_list', { p_kind: kind, ...listArgs(u, all) });
  if (error) throw error;
  return data;
}

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v == null) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;                       // stop spreadsheet formula injection
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n');
}

Deno.serve(handler(['GET', 'POST'], async (req) => {
  const db = serviceClient();
  const { email } = await requireAdmin(req, db);
  const u = new URL(req.url);
  const action = u.searchParams.get('action');

  if (req.method === 'POST') {
    const b = await readJson(req, 5_000);
    if (action === 'disqualify') {
      if (!isUuid(b.id)) throw new HttpError(400, 'Missing player id');
      const { data, error } = await db.from('profiles').update({ disqualified: b.value === true }).eq('id', b.id).select('id, disqualified').maybeSingle();
      if (error) throw error;
      if (!data) throw new HttpError(404, 'Player not found');
      return json(200, data);
    }
    if (action === 'test-email') {
      const to = String(b.to || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(to)) throw new HttpError(400, 'Enter a valid email address');
      if (!emailConfigured()) throw new HttpError(409, 'No email provider is configured (set BREVO_API_KEY or SMTP_* secrets).');
      const msg = thanksEmail({ name: b.name || 'Shreesh', score: 868, best: 868, rank: 12, total: 140 });
      try { const r = await sendEmail(db, { to, toName: b.name || '', ...msg, subject: '[TEST] ' + msg.subject, kind: 'test-thanks' }); return json(200, { thanks: r.status }); }
      catch (e) { return json(200, { thanks: 'failed: ' + e.message }); }
    }
    throw new HttpError(400, 'Unknown action');
  }

  if (action === 'whoami') return json(200, { email });
  if (action === 'health') {
    const c = emailConfig();
    return json(200, { email: { provider: c.smtpHost ? 'smtp' : c.key ? 'brevo' : null, from: c.from || null, gameUrl: c.gameUrl, knowMore: c.knowMore || null, terms: c.terms || null, campaignEnd: c.end || null } });
  }
  if (action === 'stats') {
    const { data, error } = await db.rpc('admin_stats', { p_tz: 'Asia/Kolkata' });
    if (error) throw error;
    return json(200, data);
  }
  if (action === 'leaderboard' || action === 'players' || action === 'games') return json(200, await list(db, action, u, false));
  if (action === 'export') {
    const type = u.searchParams.get('type');
    if (!['leaderboard', 'players', 'games'].includes(type)) throw new HttpError(400, 'Unknown export');
    const { rows } = await list(db, type, u, true);
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response('\uFEFF' + csv(rows), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="santa-safe-catch-${type}-${stamp}.csv"`, 'Cache-Control': 'no-store' },
    });
  }
  throw new HttpError(400, 'Unknown action');
}));
