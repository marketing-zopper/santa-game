// Turns on WhatsApp-OTP sign-in for a Supabase project. Run once (safe to re-run; it rotates the hook signing secret).
//
//   SUPABASE_ACCESS_TOKEN=sbp_…  SUPABASE_PROJECT_REF=<ref> \
//   WATI_API_TOKEN=…  WATI_API_BASE_URL=https://live-mt-server.wati.io/<tenant-id> \
//   [WATI_AUTH_TEMPLATE_NAME=sec_otpverify] [WATI_AUTH_TEMPLATE_LANGUAGE=en_US] \
//   node scripts/configure-phone-auth.mjs
//
// What it does
//   1. stores the WATI settings + a freshly generated hook signing secret as Edge Function SECRETS (never in the front end / git)
//   2. enables Supabase Phone Auth: 6-digit OTP, 10-minute expiry, 60 s resend cooldown, send-rate limit
//   3. enables the "Send SMS" Auth Hook pointing at the send-sms Edge Function (so OTPs go out on WhatsApp, not SMS)
// Deploy the functions first:  npx supabase functions deploy --project-ref <ref> --use-api
import { randomBytes } from 'node:crypto';

const need = (k) => { const v = (process.env[k] || '').trim(); if (!v) { console.error(`Missing ${k}`); process.exit(2); } return v; };
const token = need('SUPABASE_ACCESS_TOKEN'), ref = need('SUPABASE_PROJECT_REF');
const wati = {
  WATI_API_TOKEN: need('WATI_API_TOKEN'),
  WATI_API_BASE_URL: need('WATI_API_BASE_URL').replace(/\/+$/, ''),
  WATI_AUTH_TEMPLATE_NAME: (process.env.WATI_AUTH_TEMPLATE_NAME || 'sec_otpverify').trim(),
  WATI_AUTH_TEMPLATE_LANGUAGE: (process.env.WATI_AUTH_TEMPLATE_LANGUAGE || 'en_US').trim(),
};
const api = (path, method, body) => fetch(`https://api.supabase.com/v1/projects/${ref}${path}`, {
  method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

const hookSecret = 'v1,whsec_' + randomBytes(32).toString('base64');

let r = await api('/secrets', 'POST', [...Object.entries(wati), ['SEND_SMS_HOOK_SECRET', hookSecret]].map(([name, value]) => ({ name, value })));
if (!r.ok) { console.error('Setting secrets failed:', r.status, (await r.text()).slice(0, 200)); process.exit(1); }
console.log('✓ Edge Function secrets stored:', [...Object.keys(wati), 'SEND_SMS_HOOK_SECRET'].join(', '));

r = await api('/config/auth', 'PATCH', {
  external_phone_enabled: true,
  sms_autoconfirm: false,
  sms_otp_length: 6,
  sms_otp_exp: 600,              // 10 minutes — matches the "expires in 10 minutes" footer of the WhatsApp template
  sms_max_frequency: 60,         // one code per number per 60 s (the resend cooldown shown in the app)
  rate_limit_sms_sent: 300,      // codes per hour for the whole project
  hook_send_sms_enabled: true,
  hook_send_sms_uri: `https://${ref}.supabase.co/functions/v1/send-sms`,
  hook_send_sms_secrets: hookSecret,
});
if (!r.ok) { console.error('Updating auth config failed:', r.status, (await r.text()).slice(0, 300)); process.exit(1); }
console.log('✓ Phone Auth enabled (6-digit OTP, 10 min expiry, 60 s resend cooldown, 300 codes/hour)');
console.log('✓ Send SMS hook → /functions/v1/send-sms (OTPs are delivered on WhatsApp via WATI)');
console.log(`  template: ${wati.WATI_AUTH_TEMPLATE_NAME} (${wati.WATI_AUTH_TEMPLATE_LANGUAGE})`);
