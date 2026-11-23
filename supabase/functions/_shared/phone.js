// Indian mobile-number handling. SINGLE SOURCE OF TRUTH: imported by the browser (src/lib/phone.js re-exports it)
// and by the Edge Functions, so the form and the server apply exactly the same rules.

/** Accepts 9876543210, 09876543210, 919876543210, +91 98765 43210, 0091-98765-43210, … → "+919876543210", else null. */
export function normalizeIndianMobile(input) {
  if (input == null) return null;
  let d = String(input).trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '');
  if (d.startsWith('0091')) d = d.slice(4);
  else if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (!/^[6-9]\d{9}$/.test(d)) return null;          // Indian mobile numbers start with 6-9 and have 10 digits
  if (/^(\d)\1{9}$/.test(d)) return null;            // 9999999999 etc. are never real
  return '+91' + d;
}

export const isE164Indian = (v) => typeof v === 'string' && /^\+91[6-9]\d{9}$/.test(v);

/** "+919876543210" → "+91 98765 43210" */
export function formatIndianMobile(e164) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164 || '');
  return m ? `+91 ${m[1]} ${m[2]}` : String(e164 || '');
}

/** "+919876543210" → "+91 ••••• ••210" — safe for logs and screens that don't need the full number */
export function maskIndianMobile(e164) {
  const m = /^\+91\d{7}(\d{3})$/.exec(e164 || '');
  return m ? `+91 ••••• ••${m[1]}` : '••••';
}

/** "+916000001010, 6000001011" → Set { "+916000001010", "+916000001011" } (invalid entries are ignored) */
export function parseNumberList(text) {
  return new Set(String(text || '').split(/[\s,;]+/).map((x) => normalizeIndianMobile(x)).filter(Boolean));
}
