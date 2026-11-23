// Enables Supabase "test phone numbers" for the duration of the browser run (fixed OTP for a few reserved numbers, so a
// REAL OTP verification can be completed without sending WhatsApp) and switches them off again afterwards.
// Needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF; without them the phone-OTP UI specs are skipped.
import { enableTestOtp, disableTestOtp } from '../../scripts/test-otp.mjs';

export default async function globalSetup() {
  if (!process.env.SUPABASE_ACCESS_TOKEN || !process.env.SUPABASE_PROJECT_REF) return undefined;
  process.env.E2E_OTP_CODE = await enableTestOtp();
  return async () => { try { await disableTestOtp(); } catch (e) { console.error('!! could not switch test OTPs off — run: node scripts/test-otp.mjs off', e.message); } };
}
