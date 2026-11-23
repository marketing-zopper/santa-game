// Registration + WhatsApp OTP verification — ONE component used by every entry point
// (Entry Mode "Sign In with OTP", Game Home "Sign in", and the Guest Result screen's "Sign In with OTP" button).
//
//   form  →  Full name · Store / Region · WhatsApp mobile number (+91)  →  [Send OTP]
//   otp   →  six-digit code (auto-verifies), Verify OTP, Resend OTP (cooldown), Change number
//   done  →  profile created / restored; the caller takes the player to Game Home
//
// mode 'signin'   the full flow above
// mode 'complete' the phone is already verified (session exists) but registration was not finished: name + region only
//
// Nothing about the player is saved until Supabase has verified the OTP. A returning player's existing name / region
// are kept (the server never overwrites them), so typing something different here is harmless.
import { useEffect, useRef, useState } from 'react';
import Sheet from '../components/Sheet.jsx';
import { BackIcon, ChevronDownIcon, MapPinIcon, UserIcon } from '../components/icons.jsx';
import { useAuth } from '../contexts/AuthContext.jsx';
import { REGIONS } from '../lib/regions.js';
import { normalizeIndianMobile, formatIndianMobile } from '../lib/phone.js';
import { CAMPAIGN } from '../lib/campaign.js';
import { sendOtp, verifyOtp } from '../services/otpAuth.js';

const TITLES = { form: ['Join the', 'challenge'], otp: ['Check your', 'WhatsApp'], complete: ['Almost', 'there'] };
const RESEND_SECONDS = 60;

const tidyName = (v) => v.replace(/\s+/g, ' ').trim();
const nameProblem = (n) => (n.length < 2 ? 'Please enter your full name.' : n.length > 60 ? 'Please use 60 characters or fewer for your name.' : /[<>]/.test(n) || !/\p{L}/u.test(n) ? 'Please enter your real name using letters.' : null);

const Flag = () => (
  <svg viewBox="0 0 24 16" aria-hidden="true"><rect width="24" height="5.33" fill="#FF9933" /><rect y="5.33" width="24" height="5.34" fill="#fff" /><rect y="10.67" width="24" height="5.33" fill="#138808" /><circle cx="12" cy="8" r="2" fill="none" stroke="#000080" strokeWidth=".8" /></svg>
);

export default function AuthSheet({ mode = 'signin', onClose, onDone }) {
  const auth = useAuth();
  const [step, setStep] = useState(mode === 'complete' ? 'complete' : 'form');
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState(null);                // normalised E.164 once the form is valid
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);                // { text, field }
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [bad, setBad] = useState(false);
  const [focus, setFocus] = useState(false);
  const verified = useRef(false);                          // OTP accepted by Supabase; only registration may still need a retry
  const submitting = useRef(false);
  const panel = useRef(null);
  const codeInput = useRef(null);

  useEffect(() => { if (panel.current) panel.current.scrollTop = 0; }, [step]);
  useEffect(() => { if (step === 'otp') { const t = setTimeout(() => codeInput.current && codeInput.current.focus(), 250); return () => clearTimeout(t); } return undefined; }, [step]);
  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const fail = (text, field) => setError({ text, field });
  const finish = async () => {
    const profile = await auth.completeRegistration(tidyName(name), region);
    onDone(profile);
  };

  /* ---------- step 1: registration form ---------- */
  const submitForm = async (e) => {
    e.preventDefault();
    if (submitting.current) return;
    setError(null);
    const n = tidyName(name);
    const np = nameProblem(n);
    if (np) return fail(np, 'name');
    if (!REGIONS.includes(region)) return fail('Please choose your Croma store region.', 'region');
    if (mode === 'complete') {
      submitting.current = true; setBusy(true);
      try { await finish(); } catch (ex) { fail(ex.message); } finally { submitting.current = false; setBusy(false); }
      return;
    }
    const p = normalizeIndianMobile(phoneInput);
    if (!p) return fail('Please enter a valid 10-digit Indian mobile number.', 'phone');
    submitting.current = true; setBusy(true);
    try {
      await sendOtp(p);
      setPhone(p); setName(n); setCode(''); setBad(false); setCooldown(RESEND_SECONDS); setStep('otp');
    } catch (ex) {
      const secs = /(\d+) seconds/.exec(ex.message);
      if (ex.code === 'rate_limited' && secs) { setPhone(p); setCooldown(Number(secs[1])); }
      fail(ex.message, ex.code === 'invalid_phone' ? 'phone' : undefined);
    } finally { submitting.current = false; setBusy(false); }
  };

  /* ---------- step 2: verify the code ---------- */
  const submitCode = async (e, value) => {
    if (e) e.preventDefault();
    const c = value ?? code;
    if (submitting.current) return;
    if (c.length !== 6) { setBad(true); return fail('Enter the 6-digit code from WhatsApp.'); }
    submitting.current = true; setBusy(true); setError(null);
    try {
      if (!verified.current) { await verifyOtp(phone, c); verified.current = true; }
      await finish();
    } catch (ex) {
      if (!verified.current) { setBad(true); if (ex.code === 'invalid_or_expired') setCode(''); }
      fail(ex.message);
    } finally { submitting.current = false; setBusy(false); }
  };
  const onCode = (v) => {
    const digits = v.replace(/\D/g, '').slice(0, 6);
    setCode(digits); setBad(false); setError(null);
    if (digits.length === 6) submitCode(null, digits);       // auto-verify on the 6th digit
  };

  const resend = async () => {
    if (cooldown > 0 || busy || verified.current) return;
    setBusy(true); setError(null);
    try { await sendOtp(phone); setCode(''); setBad(false); setCooldown(RESEND_SECONDS); }
    catch (ex) { const secs = /(\d+) seconds/.exec(ex.message); if (secs) setCooldown(Number(secs[1])); fail(ex.message); }
    finally { setBusy(false); }
  };
  const changeNumber = () => { setStep('form'); setCode(''); setError(null); setBad(false); };

  const back = () => { if (step === 'otp' && !verified.current) changeNumber(); else onClose(); };
  const [t1, t2] = TITLES[step];
  const err = (f) => (error && error.field === f ? 'true' : undefined);
  const cur = Math.min(code.length, 5);

  return (
    <Sheet locked>
      <div className="panel headed sheet-panel has-back" role="dialog" aria-labelledby="authTitle" id="authSheet" ref={panel}>
        <button className="reg-back" id="authBack" type="button" aria-label="Back" onClick={back}><BackIcon /></button>
        <div className="p-head reg-head">
          <img className="reg-santa" src="/assets/santa.webp" alt="" />
          <span className="tag">Zopper Christmas Challenge</span>
          <h2 className="reg-title" id="authTitle"><i>{t1}</i><span>{t2}</span></h2>
        </div>
        <div className="p-body">
          {step !== 'otp' ? (
            <form className="reg-form" id="regForm" noValidate onSubmit={submitForm}>
              {mode === 'complete' ? <p className="reg-lead">Your number is verified. Tell us who you are to start playing.</p> : null}
              <label className="rfield"><span className="rlbl">Full name</span>
                <span className="rwrap"><UserIcon />
                  <input id="regName" name="name" autoComplete="name" maxLength={60} required placeholder="Rahul Sharma" value={name}
                    aria-invalid={err('name')} onChange={(e) => { setName(e.target.value); setError(null); }} /></span></label>
              <label className="rfield"><span className="rlbl">Store / Region</span>
                <span className="rwrap"><MapPinIcon />
                  <select id="regRegion" name="region" required value={region} aria-invalid={err('region')} onChange={(e) => { setRegion(e.target.value); setError(null); }}>
                    <option value="" disabled>Select your Croma region</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select><ChevronDownIcon /></span></label>
              {mode !== 'complete' ? (
                <label className="rfield"><span className="rlbl">WhatsApp mobile number</span>
                  <span className="rwrap"><span className="cc"><Flag />+91</span>
                    <input id="regPhone" name="phone" type="tel" autoComplete="tel-national" inputMode="numeric" maxLength={16} required placeholder="98765 43210" value={phoneInput}
                      aria-invalid={err('phone')}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d+\s]/g, '');
                        const full = normalizeIndianMobile(raw);          // pasted "+91 98765 43210" → just the 10 digits
                        setPhoneInput(full && raw.replace(/\D/g, '').length > 10 ? full.slice(3) : raw); setError(null);
                      }} /></span></label>
              ) : null}
              {error ? <p className="form-err" id="regErr" role="alert">{error.text}</p> : null}
              <button className="btn" id="regSubmit" type="submit" disabled={busy}><span>{busy ? (mode === 'complete' ? 'Saving…' : 'Sending code…') : mode === 'complete' ? 'Continue' : 'Send OTP'}</span></button>
              <p className="fine">
                {mode === 'complete' ? '' : "We'll send a 6-digit code to this number on WhatsApp. "}
                By continuing you agree that Zopper may store your name, WhatsApp number, store region and scores to run this contest.
                {CAMPAIGN.termsUrl ? <> <a href={CAMPAIGN.termsUrl} target="_blank" rel="noopener">Terms</a>.</> : null}
              </p>
            </form>
          ) : (
            <form className="reg-form" id="otpForm" noValidate onSubmit={submitCode}>
              <p className="reg-lead">We've sent a 6-digit code on WhatsApp to <b id="otpTo">{formatIndianMobile(phone)}</b>. It can take a minute to arrive.</p>
              <div className={'otp-box' + (focus ? ' focus' : '') + (bad ? ' bad' : '')}>
                <input id="otpInput" ref={codeInput} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="6-digit code"
                  value={code} disabled={busy && !verified.current} onChange={(e) => onCode(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} />
                <div className="otp-cells" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={i === cur ? 'cur' : ''}>{code[i] || ''}</span>)}</div>
              </div>
              {error ? <p className="form-err" id="otpErr" role="alert">{error.text}</p> : null}
              <button className="btn" id="otpSubmit" type="submit" disabled={busy}><span>{busy ? 'Checking…' : verified.current ? 'Try again' : 'Verify OTP'}</span></button>
              <div className="otp-row">
                <button type="button" className="linkish" id="otpResend" disabled={cooldown > 0 || busy || verified.current} onClick={resend}>{cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}</button>
                {!verified.current ? <button type="button" className="linkish" id="otpChange" onClick={changeNumber}>Change number</button> : null}
              </div>
            </form>
          )}
        </div>
      </div>
    </Sheet>
  );
}
