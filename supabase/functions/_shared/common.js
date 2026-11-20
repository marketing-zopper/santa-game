// Shared helpers for the Edge Functions (Deno runtime, plain JavaScript).
//
// Auth model: the functions are deployed with verify_jwt = false (see supabase/config.toml) and verify the caller
// here instead, with auth.getUser(<access token>). That keeps working whichever JWT signing key the project uses
// and lets each function decide what an unauthenticated request means.
import { createClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition',
  'Access-Control-Max-Age': '86400',
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

/** Service-role client. Server-side only: bypasses RLS. Never expose this key to the browser. */
export function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new HttpError(500, 'Server is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Resolve the signed-in user from the Authorization: Bearer <access token> header. */
export async function requireUser(req, db) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') || '');
  if (!m) throw new HttpError(401, 'Please sign in again');
  const { data, error } = await db.auth.getUser(m[1]);
  if (error || !data?.user) throw new HttpError(401, 'Please sign in again');
  return data.user;
}

export async function readJson(req, limit = 3_000_000) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > limit) throw new HttpError(413, 'Request too large');
  const raw = await req.text();
  if (raw.length > limit) throw new HttpError(413, 'Request too large');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, 'Invalid JSON'); }
}

/** Wrap a handler: CORS preflight, method check, uniform JSON errors (details of 5xx are never leaked). */
export function handler(methods, fn) {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, 'Method not allowed');
      return await fn(req);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status >= 500) console.error(e);
      return json(status, { error: e instanceof HttpError ? e.message : 'Something went wrong. Please try again.' });
    }
  };
}

/** Signed in through Google (not an email/password account) with a verified email. Mirrors public.is_google_verified(). */
export function isGoogleVerified(user) {
  const app = user.app_metadata || {};
  const google = app.provider === 'google' || (Array.isArray(app.providers) && app.providers.includes('google'));
  return google && !!(user.user_metadata?.email_verified ?? user.email_confirmed_at);
}

export const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
export const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
export const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

/** Best-effort network location from the edge (Cloudflare headers). Missing values are simply null. */
export function ipGeo(req) {
  const h = (n) => { const v = req.headers.get(n); try { return v ? decodeURIComponent(v) : null; } catch { return v; } };
  return { city: h('cf-ipcity'), region: h('cf-region-code') || h('cf-region'), country: h('cf-ipcountry') };
}
