> **Update:** a follow-up change (migration 004) made Google sign-in **admin-only** (`/admin`, one admin: `marketingext@zopper.com`). Google sessions no longer work for players, Google accounts get no profile, and only phone players can play. Decision 1 and the "Admin" row below describe the earlier state.

# WATI WhatsApp-OTP sign-in & Croma region data — change report

Branch `feature/wati-otp-regions` (from `feature/react-supabase-migration`). Targeted update: gameplay, scoring, animations, audio,
the global leaderboard logic and the existing admin features are unchanged.

## 1. What changed

| Area | Change |
|---|---|
| Player sign-in | Google Sign-In removed from the player app → **Sign In with OTP** (Supabase Phone Auth; OTP delivered on WhatsApp through WATI via a Send-SMS Auth Hook) |
| Registration | **Full name · Store / Region (exactly four Croma regions) · WhatsApp number (+91 → E.164)**, then OTP. The profile is created **only after Supabase verifies the OTP** |
| Guest result screen | New secondary action **Sign In with OTP** + the message *"Want to save your future scores and climb the leaderboard? Sign in to compete!"*. Cancel restores the result; Play Again stays guest; the finished round is **never** saved, counted, or attached to the new account |
| Regions | Region copied onto every game **session** and **game** (historical snapshot). Region report + filters + CSV in the admin dashboard |
| Existing data | 5 Google players, their scores and 11 games preserved (verified before/after); their region stays `NULL` ("Legacy / unknown") — nothing invented, nothing merged |
| Admin | Still Google sign-in + `admin_users` allow-list (admin depends on it). Added region filter, phone + region columns/search, Region-wise performance panel, region-report CSV |

## 2. Journey as implemented

Scan QR → Loading → Introduction → Choose Entry Mode →
- **Sign In with OTP** → Registration form → WhatsApp OTP (WATI) → Verify OTP → Game Home → Start → Play → Game Over → Results (Play Again / Leaderboard)
- **Play as Guest** → Game Home → Start → Play → Game Over → Guest Result (Play Again / **Sign In with OTP**)

Sign-in is reachable from three places through **one** component (`AuthSheet`): Entry Mode, the guest "Playing as Guest · Sign in"
chip on Game Home, and the guest Result screen. A valid stored session still skips straight to Game Home. A returning player
with no session signs in with the same phone + OTP and gets the **existing** account, best score and rank back.

## 3. WATI integration — what was verified from the connected account

| Item | Finding |
|---|---|
| Base URL / API | `https://live-mt-server.wati.io/389513`; **API v1** works (`/api/v1/getMessageTemplates`, `/api/v1/sendTemplateMessage`); v3 (`/api/ext/v3/…`) returns 404 on this tenant |
| Auth | `Authorization: Bearer <token>` — token accepted |
| Templates | 245 in the account, only **2 are `AUTHENTICATION`**: `sec_otpverify` and `sec_verify`, both **APPROVED**, `en_US`, body `{{1}} is your verification code. For your security, do not share this code.` |
| Chosen | **`sec_otpverify`** (Copy-code button, "expires in 10 minutes"). `sec_verify` shows a `launch_catalog` button type (looks misconfigured) and a 6-minute footer |
| Request | `POST …/sendTemplateMessage?whatsappNumber=91XXXXXXXXXX` body `{template_name, broadcast_name, parameters:[{name:"1", value:"<otp>"}]}` — confirmed accepted: WATI rendered *"301104 is your verification code…"* |
| OTP expiry | Set to **10 minutes** to match the template footer |

Credentials live only in **Edge Function secrets** (`WATI_API_TOKEN`, `WATI_API_BASE_URL`, `WATI_AUTH_TEMPLATE_NAME`,
`WATI_AUTH_TEMPLATE_LANGUAGE`, `SEND_SMS_HOOK_SECRET`). A scan of the working tree and every commit finds none in git, the
front end bundle, or logs (errors are scrubbed).

## 4. Security & abuse controls

- OTP generation, storage, expiry, resend cooldown (60 s), rate limits and **verification** are Supabase's; the app only gets a session after `verifyOtp` succeeds.
- Hook: Standard-Webhooks **signature required** (unsigned / bad / stale / replayed → 401; unit-tested against the published reference vector); India-only numbers; **5 sends per number per hour** before any WhatsApp message is spent; hard 4 s WATI budget (Supabase allows hooks 5 s); WATI errors never include the token or the OTP.
- `complete_registration`: needs a Supabase-verified phone; phone comes from the auth record; name 2–60 chars with a letter and no `<>`; region must exist (FK); **never overwrites** an existing profile.
- A phone player without a profile: `touch_profile → registered:false`, `start-game → 403`, leaderboard withheld; `start-game` can no longer "repair" (create) a profile for them.
- Players cannot write their own region / phone / scores (no write grants); they can read only their own row.
- Reserved test numbers can never trigger a WhatsApp send (`SEND_SMS_SKIP_NUMBERS`) and test OTPs are switched off after every run.

## 5. Decisions you may want to revisit

1. **Legacy Google sessions keep working.** A returning Google player whose browser still holds a valid session lands on Game Home as before (region `NULL`). They cannot sign in via Google again once signed out. Say so if you'd rather force everyone through OTP.
2. **No consent checkbox** — the required fields are exactly the three you listed; consent is stated in text under the form (as before).
3. **Region cannot be changed by players**; an admin/SQL correction does not rewrite past games (snapshot).
4. **Thank-you email** is only sent to players who have an email (legacy Google players); phone players don't have one, so nothing is sent (no WhatsApp thank-you was requested).
5. `profiles.email_verified` was **renamed `verified`** (meaning verified phone *or* verified Google), and the old GPS-state column `profiles.region` was **renamed `geo_region`** (data kept) so `region` could hold the Croma region.
6. "Main menu" on the Results screen is kept (original element).

## 6. Verification

| Suite | Result |
|---|---|
| Unit (Vitest): engine parity with the original, phone rules (+91/E.164), regions, WATI request/response mapping, token/OTP never leak, webhook signature incl. reference vector & replay window | **94 / 94** |
| Live backend (`npm run verify:backend`): RLS, validated scores, tamper/retry, **phone registration rules, no-profile-before-registration, returning-player no-overwrite, region FK / snapshot / immutability, admin region filters + report + CSV, OTP send cap**, non-Google accounts | **97 / 97** |
| Browser (Playwright, real Chrome): guest, **OTP sign-in & registration**, **guest → sign-in from results**, signed-in, legacy Google, admin incl. regions, responsive 320–1280 px | **43 / 43** (final run: see §8) |
| Real Auth → Hook round trip (`SEND_SMS_DRY_RUN`): signature accepted, reply format accepted, 60 s cooldown enforced | verified |
| Live DB before/after the migration | 5 players, identical scores, 11 games, all legacy regions `NULL`; migration re-run is a no-op |

## 7. Things to know — including a mistake

- **One stray WhatsApp send attempt.** While testing, Supabase called the hook for a *test* phone number (it does so even for test numbers) and my first hook version spent >5 s on a template lookup, timing out at Supabase but **continuing to run**. It sent one `sec_otpverify` message to **+91 6000001010**: WATI shows it as FAILED ("undeliverable") and created an **INVALID contact** `916000001010` in your WATI account. Fixed: template check moved to the background, 4 s send budget, and a skip-list so reserved test numbers are never messaged. You may want to delete that contact in WATI.
- **Real delivery to a real phone has not been tested** (no number was provided). Everything up to the WATI call is verified, WATI accepted the template request, and the message text rendered correctly — but I could not confirm the OTP arrives with the Copy-code button on a handset, nor typical WATI latency against Supabase's 5-second hook limit (template list calls took 0.8–2.3 s; the send call itself was not timed). **Please send yourself one OTP** (§ README "Smoke test").
- **Numbers not on WhatsApp**: WATI accepts the request and fails asynchronously, so the player sees the OTP screen but receives nothing (they can use *Change number*).
- **Rotate the credentials you pasted in chat** — the WATI API token and the Supabase access token (and earlier the Google client secret). They are not in git, but they are in this conversation.
- The live site (`santa-game-zopper.vercel.app`) still serves the previous build until this branch is deployed. The database/Edge changes are already live and **backward compatible** with it (Google sign-in still works there; its admin page will show a "Not verified" pill because the column was renamed).
- Not tested: iOS/Android devices, load/concurrency, WATI outage behaviour beyond error mapping.
