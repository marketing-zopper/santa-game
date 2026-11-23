// POST /functions/v1/finish-game   (Authorization: Bearer <Supabase access token>)
//   { sessionId, inputs:[tick,x,tick,x,...], endTick, clientScore, lat, lng, accuracy, city, region, country }
//   → { score, best, rank, total, flagged, emailed, duplicate? }
//
// The anti-cheat model of the original game, unchanged: the server re-runs the whole game from the seed IT chose
// plus the recorded sleigh moves (the shared deterministic engine) and saves ITS score — never the number the phone
// reports. The score the browser claims is only compared and stored for audit.
//
// Retries are safe: a session can be saved exactly once; repeating the call for an already-saved game returns the
// stored result instead of creating a second record.
import { handler, json, serviceClient, requireUser, readJson, HttpError, ipGeo, clip, num, isUuid } from '../_shared/common.js';
import { replay } from '../_shared/engine.js';
import { emailConfigured, sendEmail, thanksEmail } from '../_shared/email.js';

const MAX_TICKS = 60 * 60 * 45; // 45 minutes of play

Deno.serve(handler(['POST'], async (req) => {
  const db = serviceClient();
  const user = await requireUser(req, db);
  const b = await readJson(req, 4_000_000);

  if (!isUuid(b.sessionId)) throw new HttpError(400, 'Missing game id');
  const inputs = b.inputs;
  if (!Array.isArray(inputs) || inputs.length % 2 || inputs.length > MAX_TICKS * 2) throw new HttpError(400, 'Invalid game data');
  let prev = 0;
  for (let i = 0; i < inputs.length; i += 2) {
    const t = inputs[i], x = inputs[i + 1];
    if (!Number.isInteger(t) || t < prev || t > MAX_TICKS || typeof x !== 'number' || !Number.isFinite(x)) throw new HttpError(400, 'Invalid game data');
    prev = t;
  }
  const endTick = Number.isInteger(b.endTick) && b.endTick > 0 ? Math.min(b.endTick, MAX_TICKS) : MAX_TICKS;

  const { data: s, error: sErr } = await db.from('game_sessions')
    .select('seed, created_at, used_at').eq('id', b.sessionId).eq('player_id', user.id).maybeSingle();
  if (sErr) throw sErr;
  if (!s) throw new HttpError(404, 'Game not found');

  if (s.used_at) return await alreadySaved(db, user.id, b.sessionId);

  const age = (Date.now() - new Date(s.created_at).getTime()) / 1000;
  const r = replay(Number(s.seed), inputs, endTick, MAX_TICKS);

  // A game can't take less real time than it took to play (60 ticks = 1 second). Allow a little slack.
  const flags = [];
  if (r.t > age + 8 && Deno.env.get('SKIP_TIME_CHECK') !== '1') flags.push('faster_than_real_time');
  if (age > 6 * 3600) flags.push('stale_session');
  const clientScore = Number.isInteger(b.clientScore) ? b.clientScore : null;
  if (clientScore != null && clientScore !== r.score) flags.push('client_mismatch:' + clientScore);
  const flagged = flags.some((f) => f !== 'client_mismatch:' + clientScore);

  const ip = ipGeo(req);
  const gps = num(b.lat, -90, 90) != null && num(b.lng, -180, 180) != null;
  const { data: st, error } = await db.rpc('record_game', {
    p_player: user.id, p_session: b.sessionId, p_score: r.score, p_client_score: clientScore,
    p_duration: Math.round(r.t * 10) / 10, p_caught: r.caught, p_flagged: flagged, p_flag_reason: flags.join(',') || null,
    p_lat: gps ? num(b.lat, -90, 90) : null, p_lng: gps ? num(b.lng, -180, 180) : null,
    p_accuracy: gps ? num(b.accuracy, 0, 1e6) : null,
    p_city: gps ? clip(b.city, 80) : null, p_region: gps ? clip(b.region, 80) : null, p_country: gps ? clip(b.country, 80) : null,
    p_ip_city: ip.city, p_ua: clip(req.headers.get('user-agent'), 300),
  });
  if (error) {
    if (/session_used_or_missing/.test(error.message)) return await alreadySaved(db, user.id, b.sessionId);   // lost a race with a retry
    throw error;
  }
  const standing = Array.isArray(st) ? st[0] : st;

  // First finished game → thank-you email (sent once; if sending fails it is retried after the next game).
  // Entirely optional: skipped when no email provider is configured.
  let emailed = false;
  if (emailConfigured()) {
    const { data: claim } = await db.from('profiles')
      .update({ thanks_sent_at: new Date().toISOString() })
      .eq('id', user.id).is('thanks_sent_at', null).not('email', 'is', null).select('display_name, email').maybeSingle();   // phone players have no email → no email is sent
    if (claim?.email) {
      try {
        const msg = thanksEmail({ name: claim.display_name, score: r.score, best: standing.out_best, rank: standing.out_rank == null ? null : Number(standing.out_rank), total: Number(standing.out_total) });
        await sendEmail(db, { to: claim.email, toName: claim.display_name, ...msg, kind: 'thanks', playerId: user.id });
        emailed = true;
      } catch (e) {
        await db.from('profiles').update({ thanks_sent_at: null }).eq('id', user.id);
        if (!e.emailFailed) console.error(e);
      }
    }
  }

  return json(200, {
    emailed, score: r.score, caught: r.caught, best: standing.out_best,
    rank: standing.out_rank == null ? null : Number(standing.out_rank), total: Number(standing.out_total), flagged,
  });
}));

async function alreadySaved(db, playerId, sessionId) {
  const { data, error } = await db.rpc('saved_game_result', { p_player: playerId, p_session: sessionId });
  if (error) throw error;
  if (!data) throw new HttpError(409, 'This game was already saved');
  return json(200, {
    emailed: false, score: data.score, caught: data.caught, best: data.best,
    rank: data.rank == null ? null : Number(data.rank), total: Number(data.total ?? 0), flagged: !!data.flagged, duplicate: true,
  });
}
