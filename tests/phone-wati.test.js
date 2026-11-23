// Phone normalisation, regions, the WATI request/response handling and the Auth-Hook signature check.
import { describe, expect, it } from 'vitest';
import { normalizeIndianMobile, formatIndianMobile, maskIndianMobile, isE164Indian, parseNumberList } from '../src/lib/phone.js';
import { REGIONS, isRegion } from '../src/lib/regions.js';
import { buildSendRequest, readWatiConfig, sendWhatsAppOtp, checkAuthTemplate, verifyWebhook, signWebhook, WatiError } from '../supabase/functions/_shared/wati.js';

describe('Indian mobile normalisation (+91, E.164)', () => {
  it.each([
    ['9876543210', '+919876543210'], ['98765 43210', '+919876543210'], ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'], ['+91 98765 43210', '+919876543210'], ['+91-98765-43210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'], ['  +91(98765)43210 ', '+919876543210'], ['6000000001', '+916000000001'],
  ])('accepts %s', (input, want) => expect(normalizeIndianMobile(input)).toBe(want));

  it.each([
    [''], [null], [undefined], ['12345'], ['5876543210'], ['0987654321'], ['98765432101'], ['+1 415 555 0123'], ['+44 7911 123456'],
    ['abcdefghij'], ['98765-4321x'], ['9999999999'], ['+91 12345 67890'], ['++919876543210'],
  ])('rejects %j', (input) => expect(normalizeIndianMobile(input)).toBeNull());

  it('formats and masks without leaking the whole number', () => {
    expect(formatIndianMobile('+919876543210')).toBe('+91 98765 43210');
    expect(maskIndianMobile('+919876543210')).toBe('+91 ••••• ••210');
    expect(maskIndianMobile('garbage')).toBe('••••');
    expect(isE164Indian('+919876543210')).toBe(true);
    expect(isE164Indian('919876543210')).toBe(false);
  });
});

describe('reserved test-number list', () => {
  it('parses a mixed comma / space separated list and ignores junk', () => {
    expect([...parseNumberList('+916000001010, 6000001011 ; 916000001012\nnonsense, 123')].sort()).toEqual(['+916000001010', '+916000001011', '+916000001012']);
    expect(parseNumberList('').size).toBe(0);
    expect(parseNumberList(undefined).size).toBe(0);
  });
});

describe('regions', () => {
  it('are exactly the four Croma regions, in order', () => {
    expect(REGIONS).toEqual(['Croma East Region', 'Croma South Region', 'Croma North Region', 'Croma West Region']);
    expect(isRegion('Croma East Region')).toBe(true);
    expect(isRegion('Croma Central Region')).toBe(false);
    expect(isRegion('')).toBe(false);
  });
});

const cfg = { base: 'https://live-mt-server.wati.io/389513', token: 'tok_secret_value', templateName: 'sec_otpverify', language: 'en_US' };

describe('WATI configuration', () => {
  it('reads the four settings and trims the base URL', () => {
    const env = { WATI_API_BASE_URL: 'https://live-mt-server.wati.io/389513/', WATI_API_TOKEN: ' tok ', WATI_AUTH_TEMPLATE_NAME: 'sec_otpverify', WATI_AUTH_TEMPLATE_LANGUAGE: 'en_US' };
    expect(readWatiConfig((k) => env[k])).toEqual({ base: 'https://live-mt-server.wati.io/389513', token: 'tok', templateName: 'sec_otpverify', language: 'en_US' });
  });
  it('fails closed when anything is missing, naming it only in the server detail', () => {
    try { readWatiConfig((k) => (k === 'WATI_API_TOKEN' ? '' : 'x')); throw new Error('should have thrown'); }
    catch (e) { expect(e).toBeInstanceOf(WatiError); expect(e.code).toBe('not_configured'); expect(e.detail).toContain('WATI_API_TOKEN'); expect(e.userMessage).not.toContain('WATI'); }
  });
  it('refuses a non-https base URL', () => {
    expect(() => readWatiConfig((k) => ({ WATI_API_BASE_URL: 'http://insecure', WATI_API_TOKEN: 't', WATI_AUTH_TEMPLATE_NAME: 'n', WATI_AUTH_TEMPLATE_LANGUAGE: 'en' }[k]))).toThrow(WatiError);
  });
});

describe('WATI send request (v1 sendTemplateMessage)', () => {
  it('builds the documented request', () => {
    const { url, init } = buildSendRequest(cfg, '+919876543210', '482913');
    expect(url).toBe('https://live-mt-server.wati.io/389513/api/v1/sendTemplateMessage?whatsappNumber=919876543210');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok_secret_value');
    expect(JSON.parse(init.body)).toEqual({ template_name: 'sec_otpverify', broadcast_name: 'santa_game_otp', parameters: [{ name: '1', value: '482913' }] });
  });
  it('does not double the Bearer prefix', () => {
    expect(buildSendRequest({ ...cfg, token: 'Bearer abc' }, '+919876543210', '1').init.headers.Authorization).toBe('Bearer abc');
  });

  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  it('succeeds when WATI accepts the message', async () => { await expect(sendWhatsAppOtp(cfg, '+919876543210', '123456', reply(200, { result: true }))).resolves.toBeUndefined(); });
  it.each([
    [401, {}, 'auth'], [403, {}, 'auth'], [429, {}, 'rate_limited'], [500, { info: 'boom' }, 'wati_error'],
    [200, { result: false, info: 'Template not found' }, 'wati_rejected'], [200, { result: true, validWhatsAppNumber: false }, 'not_on_whatsapp'],
  ])('maps HTTP %s %j → %s', async (status, body, code) => {
    await expect(sendWhatsAppOtp(cfg, '+919876543210', '123456', reply(status, body))).rejects.toMatchObject({ code });
  });
  it('maps a network failure to a retryable error', async () => {
    await expect(sendWhatsAppOtp(cfg, '+919876543210', '123456', async () => { throw new TypeError('fetch failed'); })).rejects.toMatchObject({ code: 'network' });
  });
  it('never leaks the token or the OTP into error text', async () => {
    for (const f of [reply(500, { info: 'x' }), reply(401, {}), reply(200, { result: false, info: 'nope' })]) {
      try { await sendWhatsAppOtp(cfg, '+919876543210', '482913', f); } catch (e) {
        expect(e.message + e.userMessage + e.detail).not.toContain('tok_secret_value');
        expect(e.message + e.userMessage + e.detail).not.toContain('482913');
      }
    }
  });
});

describe('WATI template check', () => {
  const tpl = (over) => ({ elementName: 'sec_otpverify', status: 'APPROVED', category: 'AUTHENTICATION', language: { value: 'en_US' }, ...over });
  const lists = (...pages) => { let i = 0; return async () => new Response(JSON.stringify({ messageTemplates: pages[Math.min(i++, pages.length - 1)] })); };
  it('accepts an approved authentication template in the right language', async () => { expect(await checkAuthTemplate(cfg, lists([tpl()]))).toEqual({ ok: true }); });
  it('finds it on a later page', async () => {
    const filler = Array.from({ length: 100 }, (_, i) => tpl({ elementName: 'other' + i }));
    expect(await checkAuthTemplate(cfg, lists(filler, [tpl()]))).toEqual({ ok: true });
  });
  it.each([
    [{ status: 'PENDING' }, /PENDING/], [{ category: 'MARKETING' }, /MARKETING/],
  ])('rejects %j', async (over, re) => { const r = await checkAuthTemplate(cfg, lists([tpl(over)])); expect(r.ok).toBe(false); expect(r.reason).toMatch(re); });
  it('rejects a wrong language / missing template', async () => { expect((await checkAuthTemplate(cfg, lists([tpl({ language: { value: 'hi' } })]))).ok).toBe(false); });
  it('does not block sending when the lookup itself fails', async () => { expect(await checkAuthTemplate(cfg, async () => new Response('x', { status: 500 }))).toEqual({ ok: null }); });
});

describe('Supabase Auth Hook signature (Standard Webhooks)', () => {
  // Reference vector published with the Standard Webhooks specification
  const ref = { id: 'msg_p5jXN8AQM9LWM0D4loKWxJek', timestamp: '1614265330', body: '{"test": 2432232314}', secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw', signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=' };
  const now = 1614265330 * 1000;

  it('matches the reference test vector', async () => { expect(await signWebhook(ref)).toBe(ref.signature); });
  it('accepts the reference signature, with or without the Supabase "v1," secret prefix', async () => {
    expect(await verifyWebhook({ ...ref, nowMs: now })).toBe(true);
    expect(await verifyWebhook({ ...ref, secret: 'v1,' + ref.secret, nowMs: now })).toBe(true);
  });
  it('accepts when one of several signatures matches', async () => {
    expect(await verifyWebhook({ ...ref, signature: 'v1,AAAA ' + ref.signature, nowMs: now })).toBe(true);
  });
  it('rejects a tampered body, id, timestamp or secret', async () => {
    expect(await verifyWebhook({ ...ref, body: '{"test": 2432232315}', nowMs: now })).toBe(false);
    expect(await verifyWebhook({ ...ref, id: 'msg_other', nowMs: now })).toBe(false);
    expect(await verifyWebhook({ ...ref, timestamp: '1614265331', nowMs: now })).toBe(false);
    expect(await verifyWebhook({ ...ref, secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSx', nowMs: now })).toBe(false);
  });
  it('rejects missing / malformed inputs and unknown signature versions', async () => {
    for (const bad of [{ id: '' }, { timestamp: '' }, { signature: '' }, { secret: '' }, { signature: 'v2,' + ref.signature.slice(3) }, { signature: 'nonsense' }, { secret: '!!!not base64!!!' }]) {
      expect(await verifyWebhook({ ...ref, ...bad, nowMs: now })).toBe(false);
    }
  });
  it('rejects replays: stale (> 5 min) and future-dated requests', async () => {
    expect(await verifyWebhook({ ...ref, nowMs: now + 301 * 1000 })).toBe(false);
    expect(await verifyWebhook({ ...ref, nowMs: now - 301 * 1000 })).toBe(false);
    expect(await verifyWebhook({ ...ref, nowMs: now + 299 * 1000 })).toBe(true);
  });
});
