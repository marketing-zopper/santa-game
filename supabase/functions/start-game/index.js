// POST /functions/v1/start-game   (Authorization: Bearer <Supabase access token>)  → { sessionId, seed }
//
// Begins an authorised game for a SIGNED-IN, REGISTERED player (phone number verified by WhatsApp OTP). The server picks the
// random seed, so the finished game can be re-played and checked by finish-game, and stamps the player's Croma region on the
// session. Guests never call this: they have no token and play with a local seed.
//
// This function never creates or repairs a profile: a profile exists only after OTP verification + registration
// (complete_registration), and Google accounts (admin only) are never players.
import { handler, json, serviceClient, requireUser, HttpError } from '../_shared/common.js';

/** Unpredictable seed in [1, 2^31 - 2], same range the original server used. */
function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % 2147483646) + 1;
}

Deno.serve(handler(['POST'], async (req) => {
  const db = serviceClient();
  const user = await requireUser(req, db);

  const { data, error } = await db.rpc('start_session', { p_player: user.id, p_seed: newSeed() });
  if (error) {
    if (/unknown_player|not_verified/.test(error.message)) throw new HttpError(403, 'Please sign in with your WhatsApp OTP to play for the leaderboard.');
    if (/rate_limited/.test(error.message)) throw new HttpError(429, 'Too many games at once. Please wait a minute.');
    throw error;
  }
  const { data: s, error: e2 } = await db.from('game_sessions').select('seed').eq('id', data).single();
  if (e2) throw e2;
  return json(200, { sessionId: data, seed: Number(s.seed) });
}));
