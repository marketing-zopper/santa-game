// WhatsApp-OTP sign-in with Supabase Phone Auth.
//
//   sendOtp(phone)            Supabase generates + stores the OTP; the Send-SMS Auth Hook delivers it on WhatsApp (WATI)
//   verifyOtp(phone, code)    Supabase checks the code and returns a session — the ONLY way a player becomes authenticated
//   completeRegistration()    creates (or restores) the player's profile AFTER verification; server-side, name + Croma region
//
// Errors are mapped to short, friendly messages; the raw Supabase error never reaches the screen.
import { supabase } from '../lib/supabase.js';

export class OtpError extends Error {
  constructor(message, { code = 'unknown', retryable = false, offline = false } = {}) { super(message); this.code = code; this.retryable = retryable; this.offline = offline; }
}

const NETWORK = "Can't reach the server. Check your internet and try again.";

/**
 * supabase-js wraps BOTH a dead network (status 0) and a server-side 5xx (e.g. the WhatsApp hook failing) in
 * AuthRetryableFetchError. Only the first one means "you are offline"; a 5xx is a delivery / server problem.
 */
function isNetworkFailure(e) {
  if (!e) return false;
  if (e.name === 'AuthRetryableFetchError') return !e.status;
  return !e.status && /failed to fetch|fetch failed|networkerror|load failed/i.test(String(e.message || ''));
}

function mapSendError(e) {
  const code = e && e.code, status = e && e.status, msg = String((e && e.message) || '');
  if (isNetworkFailure(e)) return new OtpError(NETWORK, { code: 'offline', offline: true, retryable: true });
  if (code === 'over_sms_send_rate_limit' || code === 'over_request_rate_limit' || status === 429) {
    const secs = /(\d+)\s*seconds?/i.exec(msg);
    return new OtpError(secs ? `Please wait ${secs[1]} seconds before asking for another code.` : 'Too many codes requested. Please wait a minute and try again.', { code: 'rate_limited', retryable: true });
  }
  if (code === 'validation_failed' || status === 400 && /phone/i.test(msg)) return new OtpError('Please enter a valid 10-digit Indian mobile number.', { code: 'invalid_phone' });
  if (code === 'phone_provider_disabled' || code === 'sms_send_failed' || status >= 500 || /hook|sending sms|sms/i.test(msg)) {
    return new OtpError("We couldn't send the WhatsApp code. Check the number is on WhatsApp and try again in a moment.", { code: 'delivery_failed', retryable: true });
  }
  return new OtpError("We couldn't send the WhatsApp code. Please try again.", { code: 'delivery_failed', retryable: true });
}

function mapVerifyError(e) {
  const code = e && e.code, status = e && e.status, msg = String((e && e.message) || '');
  if (isNetworkFailure(e)) return new OtpError(NETWORK, { code: 'offline', offline: true, retryable: true });
  if (code === 'over_request_rate_limit' || status === 429) return new OtpError('Too many tries. Please wait a few minutes, then request a new code.', { code: 'rate_limited' });
  if (code === 'otp_expired' || /expired|invalid/i.test(msg)) return new OtpError("That code isn't right, or it has expired. Check the code, or tap Resend OTP.", { code: 'invalid_or_expired' });
  return new OtpError("We couldn't verify that code. Please try again.", { code: 'verify_failed', retryable: true });
}

/** @param phone E.164 "+91XXXXXXXXXX" (already normalised) */
export async function sendOtp(phone) {
  if (!supabase) throw new OtpError('Sign-in is not available in this build.', { code: 'unavailable' });
  let res;
  try { res = await supabase.auth.signInWithOtp({ phone, options: { channel: 'sms' } }); }   // "sms" is the channel name; the hook delivers it on WhatsApp
  catch (e) { throw new OtpError(NETWORK, { code: 'offline', offline: true, retryable: true }); }
  if (res.error) throw mapSendError(res.error);
}

/** Verifies the 6-digit code. Resolves with the Supabase session; throws OtpError otherwise. */
export async function verifyOtp(phone, token) {
  if (!supabase) throw new OtpError('Sign-in is not available in this build.', { code: 'unavailable' });
  let res;
  try { res = await supabase.auth.verifyOtp({ phone, token, type: 'sms' }); }
  catch (e) { throw new OtpError(NETWORK, { code: 'offline', offline: true, retryable: true }); }
  if (res.error) throw mapVerifyError(res.error);
  if (!res.data || !res.data.session) throw new OtpError("We couldn't verify that code. Please try again.", { code: 'verify_failed', retryable: true });
  return res.data.session;
}

/** Creates the profile (new player) or returns the existing one untouched (returning player). */
export async function completeRegistration(name, region) {
  const { data, error } = await supabase.rpc('complete_registration', { p_name: name, p_region: region });
  if (error) {
    const msg = String(error.message || '');
    if (/invalid_name/.test(msg)) throw new OtpError('Please enter your full name (2–60 letters).', { code: 'invalid_name' });
    if (/invalid_region/.test(msg)) throw new OtpError('Please choose your Croma store region.', { code: 'invalid_region' });
    if (/phone_not_verified|not_authenticated/.test(msg)) throw new OtpError('Please verify your number with the WhatsApp code first.', { code: 'not_verified' });
    throw new OtpError("We couldn't finish signing you in. Please try again.", { code: 'register_failed', retryable: true });
  }
  return data;
}
