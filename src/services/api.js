// Calls to the Supabase Edge Functions with the signed-in player's access token.
// Error semantics are those of the original api(): `offline` = the network/server could not be reached (retry later),
// otherwise the error carries the server's message and HTTP status.
import { supabase, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase.js';

export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) { super(message); this.status = status; this.offline = offline; }
}

export async function callFunction(name, body, timeout = 9000) {
  if (!supabase) throw new ApiError('offline', { offline: true });
  const { data } = await supabase.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new ApiError('Please sign in again', { status: 401 });

  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), timeout);
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body || {}),
      signal: ctl && ctl.signal,
    });
  } catch (e) { throw new ApiError('offline', { offline: true }); }
  finally { clearTimeout(timer); }
  let j = null; try { j = await r.json(); } catch (e) { /* not json */ }
  if (!r.ok || !j) throw new ApiError((j && j.error) || 'offline', { status: r.status, offline: !j || !j.error || r.status >= 500 });
  return j;
}
