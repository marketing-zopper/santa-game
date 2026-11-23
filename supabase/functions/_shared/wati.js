// WATI WhatsApp OTP delivery + Supabase Auth Hook signature verification.
// Pure functions (no Deno globals, `fetch` and the clock are injectable) so they are unit-tested in Node.
//
// WATI API v1 (the version this tenant exposes; /api/ext/v3 returns 404):
//   GET  {base}/api/v1/getMessageTemplates?pageSize=&pageNumber=      → { messageTemplates: [{ elementName, status, category, language:{value}, … }] }
//   POST {base}/api/v1/sendTemplateMessage?whatsappNumber=91XXXXXXXXXX
//        { template_name, broadcast_name, parameters: [{ name: "1", value: "<otp>" }] }
// The approved AUTHENTICATION template used by default is "sec_otpverify" (en_US):
//   "{{1}} is your verification code. For your security, do not share this code."  + Copy-code button.

export class WatiError extends Error {
  /** @param code machine-readable reason   @param userMessage safe to show a player   @param detail for server logs only (never contains the token or the OTP) */
  constructor(code, userMessage, detail) { super(detail || userMessage); this.code = code; this.userMessage = userMessage; this.detail = detail || userMessage; }
}

const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
const bearer = (t) => (/^Bearer\s/i.test(t) ? t : `Bearer ${t}`);

/** Reads WATI settings from an env-like getter. Throws WatiError when something required is missing. */
export function readWatiConfig(get) {
  const cfg = {
    base: trimSlash(get('WATI_API_BASE_URL')),
    token: (get('WATI_API_TOKEN') || '').trim(),
    templateName: (get('WATI_AUTH_TEMPLATE_NAME') || '').trim(),
    language: (get('WATI_AUTH_TEMPLATE_LANGUAGE') || '').trim(),
  };
  const missing = Object.entries({ WATI_API_BASE_URL: cfg.base, WATI_API_TOKEN: cfg.token, WATI_AUTH_TEMPLATE_NAME: cfg.templateName, WATI_AUTH_TEMPLATE_LANGUAGE: cfg.language })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new WatiError('not_configured', "We can't send WhatsApp codes right now. Please try again later.", `Missing configuration: ${missing.join(', ')}`);
  if (!/^https:\/\//.test(cfg.base)) throw new WatiError('not_configured', "We can't send WhatsApp codes right now. Please try again later.", 'WATI_API_BASE_URL must be an https URL');
  return cfg;
}

/** The exact HTTP request for one OTP message (exported for tests). `phone` is E.164 "+91XXXXXXXXXX". */
export function buildSendRequest(cfg, phone, otp) {
  const digits = String(phone).replace(/\D/g, '');          // WATI wants country code + number, no "+"
  return {
    url: `${cfg.base}/api/v1/sendTemplateMessage?whatsappNumber=${digits}`,
    init: {
      method: 'POST',
      headers: { Authorization: bearer(cfg.token), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ template_name: cfg.templateName, broadcast_name: 'santa_game_otp', parameters: [{ name: '1', value: String(otp) }] }),
    },
  };
}

/**
 * Sends the OTP over WhatsApp. Resolves on success; throws WatiError otherwise.
 * Supabase gives an Auth Hook only 5 seconds, so the WATI call has its own hard budget (default 4 s).
 */
export async function sendWhatsAppOtp(cfg, phone, otp, fetchImpl = fetch, timeoutMs = 4000) {
  const { url, init } = buildSendRequest(cfg, phone, otp);
  let res;
  try { res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new WatiError('network', "We couldn't reach WhatsApp. Please try again in a moment.", `WATI request failed: ${e && e.name}`); }
  let j = null; try { j = await res.json(); } catch { /* not json */ }
  if (res.status === 401 || res.status === 403) throw new WatiError('auth', "We can't send WhatsApp codes right now. Please try again later.", `WATI rejected the credentials (HTTP ${res.status})`);
  if (res.status === 429) throw new WatiError('rate_limited', 'Too many codes were requested. Please wait a few minutes.', 'WATI rate limit (HTTP 429)');
  if (!res.ok) throw new WatiError('wati_error', "We couldn't send the WhatsApp code. Please try again.", `WATI HTTP ${res.status}: ${String((j && (j.info || j.message || j.title)) || '').slice(0, 160)}`);
  const accepted = j && (j.result === true || j.result === 'success' || j.ok === true);
  if (j && j.validWhatsAppNumber === false) throw new WatiError('not_on_whatsapp', "This number doesn't seem to be on WhatsApp. Check the number and try again.", 'WATI: number is not a valid WhatsApp number');
  if (!accepted) throw new WatiError('wati_rejected', "We couldn't send the WhatsApp code. Please check the number and try again.", `WATI refused the message: ${String((j && (j.info || j.message)) || 'no detail').slice(0, 160)}`);
}

/**
 * Confirms the configured template exists, is APPROVED, is an AUTHENTICATION template and has the configured language.
 * Returns { ok: true } | { ok: false, reason } | { ok: null } (could not check — do not block sending on a lookup failure).
 */
export async function checkAuthTemplate(cfg, fetchImpl = fetch) {
  try {
    for (let page = 1; page <= 10; page++) {
      const res = await fetchImpl(`${cfg.base}/api/v1/getMessageTemplates?pageSize=100&pageNumber=${page}`, { headers: { Authorization: bearer(cfg.token), Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { ok: null };
      const j = await res.json(); const list = (j && j.messageTemplates) || [];
      const t = list.find((x) => x.elementName === cfg.templateName && (x.language?.value || x.language) === cfg.language);
      if (t) {
        if (t.status !== 'APPROVED') return { ok: false, reason: `template "${cfg.templateName}" is ${t.status}, not APPROVED` };
        if (t.category !== 'AUTHENTICATION') return { ok: false, reason: `template "${cfg.templateName}" is ${t.category}, not AUTHENTICATION` };
        return { ok: true };
      }
      if (list.length < 100) break;
    }
    return { ok: false, reason: `template "${cfg.templateName}" (${cfg.language}) was not found in the WATI account` };
  } catch { return { ok: null }; }
}

/* ---------------------------------------------------------------------------------------------------------------
 * Supabase Auth Hooks are signed with the Standard Webhooks scheme:
 *   headers  webhook-id, webhook-timestamp, webhook-signature ("v1,<base64 hmac>", possibly several, space-separated)
 *   signed   `${id}.${timestamp}.${rawBody}` with HMAC-SHA256, key = base64-decoded secret ("v1,whsec_<base64>")
 * --------------------------------------------------------------------------------------------------------------- */
const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function verifyWebhook({ id, timestamp, signature, body, secret, nowMs = Date.now(), toleranceSec = 300 }) {
  if (!id || !timestamp || !signature || !secret) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec) return false;     // stale or from the future → replay protection
  let key;
  try {
    const raw = String(secret).replace(/^v1,/, '').replace(/^whsec_/, '');
    key = await crypto.subtle.importKey('raw', b64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  } catch { return false; }
  const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) continue;
    try { if (await crypto.subtle.verify('HMAC', key, b64ToBytes(sig), data)) return true; } catch { /* malformed signature */ }
  }
  return false;
}

/** Produces a valid signature for a body (used by tests and by the end-to-end check script). */
export async function signWebhook({ id, timestamp, body, secret }) {
  const raw = String(secret).replace(/^v1,/, '').replace(/^whsec_/, '');
  const key = await crypto.subtle.importKey('raw', b64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  return 'v1,' + btoa(String.fromCharCode(...sig));
}
