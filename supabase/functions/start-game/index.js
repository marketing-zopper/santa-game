// POST /functions/v1/start-game   (Authorization: Bearer <Supabase access token>)  → { sessionId, seed }
//
// Begins an authorised game for a SIGNED-IN player. The server picks the random seed, so the finished game can be
// re-played and checked by finish-game. Guests never call this: they have no token and play with a local seed.
import { handler, json, serviceClient, requireUser, isGoogleVerified, HttpError } from '../_shared/common.js';

/** Unpredictable seed in [1, 2^31 - 2], same range the original server used. */
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 2147483646) + 1;
}

/** Re-sync the profile's Auth-derived fields (name, avatar, Google-verified flag) from the verified Auth identity. */
async function syncProfile(db, user) {
  const meta = user.user_metadata || {};
  await db.from('profiles').upsert({
    id: user.id,
    display_name: String(meta.full_name || meta.name || (user.email || '').split('@')[0] || 'Player').slice(0, 120),
    email: user.email ?? null,
    avatar_url: meta.avatar_url || meta.picture || null,
    email_verified: isGoogleVerified(user),
  }, { onConflict: 'id' });
}

Deno.serve(handler(['POST'], async (req) => {
  const db = serviceClient();
  const user = await requireUser(req, db);

  const open = () => db.rpc('start_session', { p_player: user.id, p_seed: newSeed() });
  let { data, error } = await open();
  if (error && /unknown_player|not_verified/.test(error.message)) {   // profile missing or stale (e.g. Google identity linked after the row was made): re-sync from Auth, retry once
    await syncProfile(db, user);
    ({ data, error } = await open());
  }
  if (error) {
    if (/not_verified/.test(error.message)) throw new HttpError(403, 'Please sign in with Google to play for the leaderboard.');
    if (/rate_limited/.test(error.message)) throw new HttpError(429, 'Too many games at once. Please wait a minute.');
    throw error;
  }
  const { data: s, error: e2 } = await db.from('game_sessions').select('seed').eq('id', data).single();
  if (e2) throw e2;
  return json(200, { sessionId: data, seed: Number(s.seed) });
}));
