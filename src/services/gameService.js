// Server-backed game operations for SIGNED-IN players. Guests never reach this module's network calls.
import { supabase } from '../lib/supabase.js';
import { store } from '../lib/storage.js';
import { callFunction, ApiError } from './api.js';

/** Begin an authorised game: the server picks the seed so it can re-play the finished game. */
export const startSession = () => callFunction('start-game', {}, 7000, { retries: 1 });

/** Submit the recorded moves; the server re-plays the game and saves ITS score. Safe to retry (idempotent). */
export const finishSession = (payload) => callFunction('finish-game', payload, 15000, { retries: 2 });

/** Create/refresh the profile after sign-in and return { name, best, rank, total, ... }. */
export async function touchProfile() {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('touch_profile');
  if (error) throw new ApiError(error.message, { status: 500, offline: true });
  return data;
}

/** Top players ("First L." + score) plus the caller's own standing. Only works for signed-in players. */
export async function fetchLeaderboard() {
  if (!supabase) throw new ApiError('offline', { offline: true });
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_limit: 10 }).abortSignal(ctl.signal);
    if (error) throw new ApiError(error.message, { status: 500, offline: true });
    if (!data) throw new ApiError('Please sign in again', { status: 401 });
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError('offline', { offline: true });
  } finally { clearTimeout(timer); }
}

/* ---------- scores that couldn't be sent (bad network) are kept per player and retried later ---------- */
const key = (uid) => `ssc-pending:${uid}`;
export function pending(uid) { try { return JSON.parse(store.get(key(uid)) || '[]'); } catch (e) { return []; } }
export function queuePending(uid, payload) { const list = pending(uid); list.push(payload); store.set(key(uid), JSON.stringify(list.slice(-3))); }
export async function flushPending(uid) {
  const list = pending(uid); if (!list.length) return;
  const keep = [];
  for (const p of list) { try { await finishSession(p); } catch (e) { if (e.offline) keep.push(p); } }
  store.set(key(uid), JSON.stringify(keep.slice(-3)));
}
