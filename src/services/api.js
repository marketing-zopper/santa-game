// Calls to the Supabase Edge Functions with the signed-in player's access token.
// Error semantics are those of the original api(): `offline` = the network/server could not be reached (retry later),
// otherwise the error carries the server's message and HTTP status.
//
// `retries`: how many EXTRA attempts to make after a quick connection failure or a 5xx. Only used for calls that are safe to
// repeat (start-game: an extra unused session is harmless; finish-game: idempotent per session). A call that already waited
// out its full timeout is not repeated — the player has waited long enough — and 4xx answers (a real "no") never are.
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase.js';

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false, timedOut = false } = {}) { super(message); this.status = status; this.offline = offline; this.timedOut = timedOut; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(name, body, timeout) {
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new ApiError('Please sign in again', { status: 401 });

  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; if (ctl) ctl.abort(); }, timeout);
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal: ctl && ctl.signal,
    });
  } catch (e) { throw new ApiError('offline', { offline: true, timedOut }); }
  finally { clearTimeout(timer); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok || !j) throw new ApiError((j && j.error) || 'offline', { status: r.status, offline: !j || !j.error || r.status >= 500 });
  return j;
}

export async function callFunction(name, body, timeout = 9000, { retries = 0 } = {}) {
  if (!supabase) throw new ApiError('offline', { offline: true });
  for (let i = 0; ; i++) {
    try { return await attempt(name, body, timeout); }
    catch (e) {
      const retryable = e && e.offline && !e.timedOut && i < retries;
      if (!retryable) throw e;
      await sleep(500 * (i + 1));
    }
  }
}
