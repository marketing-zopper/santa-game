// Supabase "test phone numbers": fixed OTPs for a few numbers so automated tests can complete a REAL OTP verification
// without sending any WhatsApp message (Supabase skips delivery for them). Short-lived and always switched off again.
//
//   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/test-otp.mjs on  [code]    enable for 1 hour
//   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/test-otp.mjs off            remove them (do this after testing!)
//
// NEVER leave these enabled on a production project: anyone who knows the code could sign in as those numbers.
import { randomInt } from 'node:crypto';

/** 10-digit test numbers (stored by Supabase as 91XXXXXXXXXX). Chosen in a block no player will type by accident. */
export const TEST_NUMBERS = Array.from({ length: 12 }, (_, i) => `60000010${String(i + 10)}`);   // 6000001010 … 6000001021

const api = (path, method, body) => fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_REF}${path}`, {
  method, headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
});

export async function enableTestOtp(code = String(randomInt(100000, 999999))) {
  const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const r = await api('/config/auth', 'PATCH', { sms_test_otp: TEST_NUMBERS.map((n) => `91${n}=${code}`).join(','), sms_test_otp_valid_until: until });
  if (!r.ok) throw new Error(`could not enable test OTPs: ${r.status} ${(await r.text()).slice(0, 200)}`);
  // Supabase still calls the Send-SMS hook for test numbers, so the hook must be told never to message them
  const s = await api('/secrets', 'POST', [{ name: 'SEND_SMS_SKIP_NUMBERS', value: TEST_NUMBERS.map((n) => `+91${n}`).join(',') }]);
  if (!s.ok) throw new Error(`could not set SEND_SMS_SKIP_NUMBERS: ${s.status}`);
  return code;
}

export async function disableTestOtp() {
  const r = await api('/config/auth', 'PATCH', { sms_test_otp: '', sms_test_otp_valid_until: null });
  if (!r.ok) throw new Error(`could not disable test OTPs: ${r.status} ${(await r.text()).slice(0, 200)}`);
  await api('/secrets', 'DELETE', ['SEND_SMS_SKIP_NUMBERS']);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('test-otp.mjs')) {
  const [cmd, code] = process.argv.slice(2);
  if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) { console.error('Set SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF'); process.exit(2); }
  if (cmd === 'on') console.log('test OTP enabled for 1 hour. code:', await enableTestOtp(code), '\nnumbers:', TEST_NUMBERS.map((n) => '+91' + n).join(', '));
  else if (cmd === 'off') { await disableTestOtp(); console.log('test OTP disabled'); }
  else { console.error('usage: node scripts/test-otp.mjs on [code] | off'); process.exit(2); }
}
