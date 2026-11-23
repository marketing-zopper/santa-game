// Supabase "Send SMS" Auth Hook → WhatsApp OTP through WATI.
//
// Supabase Phone Auth generates the OTP, stores its hash, enforces expiry / resend cooldown / rate limits and later
// verifies the code and issues the session. This hook ONLY delivers the code: instead of SMS it sends the approved
// WhatsApp AUTHENTICATION template via WATI. It never sees a session and cannot grant access.
//
// Called by Supabase Auth (not by browsers) with a Standard-Webhooks signature — anything unsigned is rejected.
//   request  { user: { id, phone, … }, sms: { otp } }
//   success  200 {}
//   failure  non-2xx { error: { http_code, message } }  → surfaced to the player as "couldn't send the code"
//
// Secrets (Edge Function secrets; never in the front end or in git):
//   SEND_SMS_HOOK_SECRET        "v1,whsec_…" the signing secret configured on the Auth hook
//   WATI_API_TOKEN              WATI API token
//   WATI_API_BASE_URL           e.g. https://live-mt-server.wati.io/<tenant-id>
//   WATI_AUTH_TEMPLATE_NAME     approved AUTHENTICATION template, e.g. sec_otpverify
//   WATI_AUTH_TEMPLATE_LANGUAGE its language code, e.g. en_US
//   SEND_SMS_DRY_RUN            optional: "1" = verify + validate everything but do NOT send (staging / smoke tests)
//   SEND_SMS_SKIP_NUMBERS       optional: comma-separated reserved test numbers that are never sent anything (used by the automated tests)
import { serviceClient } from '../_shared/common.js';
import { normalizeIndianMobile, maskIndianMobile, parseNumberList } from '../_shared/phone.js';
import { verifyWebhook, readWatiConfig, sendWhatsAppOtp, checkAuthTemplate, WatiError } from '../_shared/wati.js';

const MAX_OTPS_PER_NUMBER_PER_HOUR = 5;
// Supabase Auth is strict about hook replies: the body must be JSON with Content-Type EXACTLY "application/json"
// (no charset suffix), otherwise it reports "Invalid payload sent to hook" — even for a successful send.
const reply = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const hookError = (status, message) => reply(status, { error: { http_code: status, message } });

// The template lookup pages through the WATI account (slow), and Supabase gives this hook only 5 s — so it runs in the
// BACKGROUND and is never awaited; its verdict (cached 10 min per warm instance) blocks sending only once it is known to be bad.
let templateCheck = { at: 0, result: null, running: false };
function refreshTemplateCheck(cfg) {
  if (templateCheck.running || Date.now() - templateCheck.at < 10 * 60 * 1000) return;
  templateCheck.running = true;
  const p = checkAuthTemplate(cfg).then((result) => { templateCheck = { at: Date.now(), result, running: false }; }).catch(() => { templateCheck.running = false; });
  if (globalThis.EdgeRuntime && globalThis.EdgeRuntime.waitUntil) globalThis.EdgeRuntime.waitUntil(p);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return hookError(405, 'Method not allowed');
  const body = await req.text();

  const signed = await verifyWebhook({
    id: req.headers.get('webhook-id'), timestamp: req.headers.get('webhook-timestamp'), signature: req.headers.get('webhook-signature'),
    body, secret: Deno.env.get('SEND_SMS_HOOK_SECRET'),
  });
  if (!signed) return hookError(401, 'Invalid signature');

  let payload;
  try { payload = JSON.parse(body); } catch { return hookError(400, 'Invalid payload'); }
  const otp = payload && payload.sms && payload.sms.otp;
  const rawPhone = payload && payload.user && payload.user.phone;
  if (typeof otp !== 'string' || !/^\d{4,10}$/.test(otp)) return hookError(400, 'Invalid payload');

  // Indian mobile numbers only: stops the WhatsApp budget being burned on foreign numbers
  const phone = normalizeIndianMobile(String(rawPhone || '').startsWith('+') ? rawPhone : '+' + String(rawPhone || ''));
  if (!phone) return hookError(400, 'Only Indian mobile numbers (+91) are supported.');
  const who = maskIndianMobile(phone);

  try {
    const cfg = readWatiConfig((k) => Deno.env.get(k));
    if (parseNumberList(Deno.env.get('SEND_SMS_SKIP_NUMBERS')).has(phone)) { console.log(`send-sms: reserved test number, nothing sent to ${who}`); return reply(200, {}); }
    if (Deno.env.get('SEND_SMS_DRY_RUN') === '1') { console.log(`send-sms: DRY RUN, nothing sent to ${who}`); return reply(200, {}); }

    // per-number cap, checked BEFORE spending a WhatsApp message
    const { data: allowed, error: capErr } = await serviceClient().rpc('hook_allow_otp', { p_phone: phone, p_max_per_hour: MAX_OTPS_PER_NUMBER_PER_HOUR });
    if (capErr) throw new WatiError('internal', "We couldn't send the WhatsApp code. Please try again.", `otp cap check failed: ${capErr.message}`);
    if (!allowed) { console.warn(`send-sms: hourly cap reached for ${who}`); return hookError(429, 'Too many codes requested for this number. Please try again later.'); }

    // the template must be approved / authentication / right language (checked in the background, verdict cached)
    refreshTemplateCheck(cfg);
    if (templateCheck.result && templateCheck.result.ok === false) {
      throw new WatiError('template', "We can't send WhatsApp codes right now. Please try again later.", `WATI template problem: ${templateCheck.result.reason}`);
    }

    await sendWhatsAppOtp(cfg, phone, otp);
    console.log(`send-sms: OTP sent over WhatsApp to ${who}`);
    return reply(200, {});
  } catch (e) {
    if (e instanceof WatiError) {
      console.error(`send-sms: ${e.code} for ${who}: ${e.detail}`);          // detail never contains the token or the code
      return hookError(e.code === 'rate_limited' ? 429 : e.code === 'not_on_whatsapp' ? 400 : 500, e.userMessage);
    }
    console.error('send-sms: unexpected error', e && e.message);
    return hookError(500, "We couldn't send the WhatsApp code. Please try again.");
  }
});
