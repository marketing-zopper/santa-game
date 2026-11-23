# Santa's Safe Catch · Zopper Christmas Challenge

In-store mobile game: swipe to move Santa and catch falling phones in his sack. React + Vite + Supabase version of the
original game (`marketing-zopper/Santa-Safe-Catch`). The game itself — artwork, CSS, canvas engine, rules, sounds — is the
original. Players **sign in with a WhatsApp OTP** (delivered through WATI) and register their **Croma region**, or play as a guest.

```
 Scan QR → Loading → Introduction → Choose entry mode ─┬─ Sign In with OTP → Registration form → WhatsApp OTP → Verify ─┐
                                                       └─ Play as Guest ──────────────────────────────────────────────┴→ Game Home
 → Start game → Gameplay → Game Over → Results ─┬─ Play again
                                                ├─ Leaderboard        (signed-in players only)
                                                └─ Sign In with OTP   (guests only — the finished round stays a guest round)
```

| | Signed in (WhatsApp OTP) | Guest |
|---|---|---|
| Gameplay, difficulty, scoring | identical | identical |
| Score saved | Yes — validated on the server, stored in Supabase with the player's **Croma region** | **No** — memory only, lost on refresh |
| Leaderboard / prizes | Yes (one global leaderboard) | **None** — no button, no screen, no data, until they sign in |
| Database profile / history | Yes | **None** |
| Browser storage | session, sound preference, offline retry queue | **nothing** |
| Network calls to Supabase | yes | **none** until they choose to sign in |

A guest who signs in from the result screen is taken to Game Home as an authenticated player. **The round they just played
is never saved, counted or attached to the account**; only games started after sign-in are saved.

## Contents
[Architecture](#architecture) · [Layout](#repository-layout) · [Local setup](#local-setup) · [Supabase setup](#supabase-setup) ·
[WhatsApp OTP setup (WATI)](#whatsapp-otp-setup-wati) · [Croma regions & reporting](#croma-regions--reporting) ·
[Admin dashboard](#admin-dashboard) · [Deploying to Vercel](#deploying-to-vercel) · [How scores are protected](#how-scores-are-protected) ·
[Testing](#testing) · [Environment variables](#environment-variables) · [Troubleshooting](#troubleshooting)

## Architecture

- **React 19 + Vite (JavaScript).** React owns screens, navigation, auth and results; the Canvas game is an imperative class
  (`src/game/GameController.js`) with **one** `requestAnimationFrame` loop outside React.
- **One engine, two runtimes.** `supabase/functions/_shared/engine.js` is the deterministic game engine. The browser imports
  it through `src/game/engine.js`; `finish-game` replays every signed-in game with the very same file.
- **Supabase Phone Auth** generates, stores, expires, rate-limits and *verifies* the OTP and issues the session.
  The **Send SMS Auth Hook** (`send-sms` Edge Function) only *delivers* the code: it sends the approved WhatsApp
  authentication template through **WATI** instead of an SMS. The hook never sees a session and cannot grant access.
- **Registration happens after verification.** A verified phone alone creates no profile. `complete_registration(name, region)`
  (server-side, `SECURITY DEFINER`) creates it, takes the phone number from the verified auth record (never from the client),
  and never overwrites an existing profile — so a returning player's name and region are always preserved.
- **Postgres + RLS** (profiles, sessions, games, regions) · **Edge Functions** `start-game`, `finish-game`, `admin`, `send-sms`.
- **Background music.** `public/assets/christmas-bg-music.mp3` loops quietly (`src/game/music.js`) and starts the moment the page lands. Browsers do not allow *audible* autoplay before a tap (Chrome, Edge, Safari and Firefox all enforce this), so it first tries to play audibly and otherwise starts **silently** and becomes audible on the visitor's very first tap/click/key. It uses a plain `<audio>` element and, only if the browser refuses muted autoplay on it (Chrome and Edge do), switches to a hidden non-rendered `<video>` playing the same MP3, which those browsers do allow. The top-right sound button toggles music and sound effects together; pausing the *game* does not stop the music; it pauses while the tab is hidden and resumes itself if an engine pauses it. Nothing is stored for guests.
- **Shared form code.** The registration + OTP screen (`src/screens/AuthSheet.jsx`) is a single component used by Entry Mode,
  Game Home and the guest Result screen.
- **Google sign-in exists ONLY on `/admin`**, for exactly one allow-listed admin (`marketingext@zopper.com`). Players never see it; a
  Google account never gets a player profile and can never play, start a game, or see the leaderboard. Historical Google players
  and their scores stay in the database as history (`auth_provider = 'google'`, `region = NULL`) and on the leaderboard; they
  would register with a phone number like anyone else (accounts are never merged automatically).

## Repository layout

```
src/
  App.jsx                 journey state machine, guest/player split, shared sign-in sheet wiring
  game/                   GameController (canvas, input, FX), draw, sprites, audio, engine re-export
  screens/                Loading, Intro, EntryMode, AuthSheet (registration + OTP), Home, HowToPlay, Leaderboard, Pause, Results
  contexts/               AuthContext (session + profile; status signedOut | needsProfile | signedIn)
  services/               otpAuth (send/verify OTP, register), gameService, api, location
  lib/                    supabase client, phone + regions (re-exports of the shared server modules), campaign copy
  styles/                 game.css (original), auth.css (original sign-up/OTP rules, restored), entry.css
  admin/                  React admin dashboard
supabase/
  migrations/             001 core schema · 002 google-only (historical) · 003 phone auth + regions · 004 Google = admin only
  functions/              start-game, finish-game, admin, send-sms, _shared (engine, common, email, phone, regions, wati)
scripts/                  configure-phone-auth.mjs · test-otp.mjs · verify-backend.mjs
tests/                    unit (Vitest) + browser (Playwright)
docs/                     MIGRATION.md (React/Supabase migration) · WATI_OTP_REGIONS.md (this update)
```

## Responsive design & browser support

The original design is a phone-portrait game; the UI layer is now responsive from 320 px phones to 2560 px monitors. On tablets, laptops and desktops the menus, sheets, HUD and banners are scaled up (CSS `zoom`, capped at 1.6x; phones are unchanged) and the HUD / menu bar stay over the playfield instead of the far screen corners; the intro's action bar sits in a centred column. See `src/styles/responsive.css` and `GameController.resize()`.

Tested in **Chrome, Edge, Firefox and WebKit (the Safari engine)** at 16 viewport sizes (iPhone SE, Android, iPhone Pro Max, iPad Air/Pro, laptops, Full HD, QHD, ultrawide). Real Safari on iOS/macOS and real devices could not be tested here. Firefox older than 126 ignores `zoom` (the UI simply stays at phone size there).

## Local setup

Node 20+.

```bash
npm install
cp .env.example .env.local        # fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                       # http://localhost:5173   (admin at /admin)
```

Guest play works with no Supabase configuration at all. Scripts: `npm run build` · `npm test` · `npm run test:e2e` · `npm run verify:backend`.

## Supabase setup

For the existing project everything below is already applied. For a new project:

1. **Database** — run the migrations in order (SQL Editor, or `npx supabase db push`):

   | Migration | Purpose |
   |---|---|
   | `20261120000001_core_schema.sql` | tables, RLS, grants, leaderboard, server functions |
   | `20261120000002_google_only.sql` | historical: "verified" = Google identity |
   | `20261123000004_google_admin_only.sql` | removes the Google auth trigger (Google accounts never get a profile); only phone players can start games / read the leaderboard; admin allow-list = exactly `marketingext@zopper.com` |
   | `20261123000003_phone_auth_regions.sql` | `regions` (exactly four), phone / region / timestamps on `profiles`, region snapshot on `game_sessions` + `games`, `complete_registration`, region reporting, OTP send cap. **Additive — existing players, scores and games are untouched** (the old GPS "region" column is preserved as `geo_region`) |

2. **Edge Functions** — `npx supabase functions deploy --project-ref <ref> --use-api`
   (`verify_jwt = false` in `supabase/config.toml`: the player/admin functions verify the caller's token themselves; `send-sms`
   verifies Supabase's signature).
3. **Turn on WhatsApp OTP** — see the next section (one command).
4. **Auth → URL Configuration** — Site URL = your production URL; add `https://<your-domain>/**` to Redirect URLs (needed for the **admin** Google login to come back to `/admin`).
5. **Anonymous sign-ins stay OFF** — guests must have no database presence.

## WhatsApp OTP setup (WATI)

**Prerequisites in WATI:** an **approved WhatsApp *Authentication* template** whose body contains the `{{1}}` OTP placeholder.
This project uses `sec_otpverify` (language `en_US`, "`{{1}} is your verification code…`", Copy-code button, 10-minute validity),
verified from the connected WATI account. WATI API v1 is used (`/api/v1/getMessageTemplates`, `/api/v1/sendTemplateMessage`).

**One command** (secrets come from your shell — nothing is stored in git):

```bash
npx supabase functions deploy --project-ref <ref> --use-api
SUPABASE_ACCESS_TOKEN=sbp_…  SUPABASE_PROJECT_REF=<ref> \
WATI_API_TOKEN=…  WATI_API_BASE_URL=https://live-mt-server.wati.io/<tenant-id> \
WATI_AUTH_TEMPLATE_NAME=sec_otpverify  WATI_AUTH_TEMPLATE_LANGUAGE=en_US \
node scripts/configure-phone-auth.mjs
```

It stores `WATI_API_TOKEN`, `WATI_API_BASE_URL`, `WATI_AUTH_TEMPLATE_NAME`, `WATI_AUTH_TEMPLATE_LANGUAGE` and a freshly generated
`SEND_SMS_HOOK_SECRET` as **Edge Function secrets**, then enables Phone Auth (6-digit OTP, **10-minute expiry**, **60 s resend
cooldown**, 300 codes/hour project-wide) and the **Send SMS hook** → `/functions/v1/send-sms`. The WATI token never reaches
React, Vite variables, GitHub or logs (error messages are scrubbed of token and OTP).

**What protects WhatsApp spend / the number book**
- Only Indian mobiles (`+91 [6-9]xxxxxxxxx`) are accepted — form, Supabase and the hook all enforce it.
- Supabase: 1 code per number per 60 s, 300/hour project-wide, verification attempts rate-limited, codes expire in 10 minutes.
- Hook: max **5 codes per number per hour** (`hook_allow_otp`), checked before a WhatsApp message is spent; hard 4 s budget
  for the WATI call (Supabase allows hooks only 5 s); template approval/category/language is checked in the background and
  a bad template blocks sending with a clear server log.
- Reserved test numbers (below) are never messaged.

**Smoke test with your own phone** — open the app → *Sign In with OTP* → enter your WhatsApp number → the code should arrive
within seconds. (Set `SEND_SMS_DRY_RUN=1` as an Edge secret to run the whole pipeline without sending.)

**Automated tests without sending WhatsApp:** `node scripts/test-otp.mjs on` gives a handful of reserved numbers a fixed OTP for
one hour and tells the hook to skip them; `node scripts/test-otp.mjs off` removes both. (The Playwright run does this itself.)

> The hook is called by Supabase even for test numbers, so a *skip list* (`SEND_SMS_SKIP_NUMBERS`) — not just the test-OTP
> setting — is what prevents a message. Never leave test OTPs enabled in production.

## Croma regions & reporting

Registration asks for **Full name**, **Store / Region** (exactly *Croma East / South / North / West Region*) and **WhatsApp number**
(+91, normalised to E.164). The region is enforced by a foreign key to `public.regions`.

- **Snapshot:** the region is copied onto every game *session* and *game* when it is played, so history keeps its original
  attribution even if a profile changes. Players cannot edit their own region or phone (no write access at all).
- **Legacy:** historical Google players (kept as history) have `region = NULL` and show as "Legacy / unknown". No region is invented.
- **Reporting** (admin only): per region — registered players, total games, valid games (not flagged), average score, highest
  score — via `admin_region_report()`, the dashboard's **Region-wise performance** panel and its CSV export. Personal best and
  per-player history are in the Players / Games tabs. The **global** leaderboard is unchanged (one board for everyone).

## Admin dashboard

`/admin` is the **only** place Google sign-in exists. The one admin is **`marketingext@zopper.com`**: that Google account signs in
and the `admin` Edge Function checks (on every call) that it is a Google-verified account listed in `public.admin_users`
(migration 004 makes that list exactly this one email). Players — including WhatsApp-OTP players — are refused. No OTP login here.

**One-time Google setup (admin login only)** — no credentials live in this repo; the Google client ID/secret are stored only in
Supabase → Authentication → Providers → Google:
1. Google Cloud Console → Credentials → OAuth client (Web) → **Authorised redirect URI** `https://<project-ref>.supabase.co/auth/v1/callback`
   (without it Google answers `redirect_uri_mismatch`), and your site as an authorised JavaScript origin.
2. Supabase → Authentication → URL Configuration → Redirect URLs includes `https://<your-domain>/**`.

To change the admin later: `update public.admin_users set email = 'new@zopper.com' where true;` (lower-case).

KPIs, per-day charts, players by city, **Region-wise performance**, Leaderboard / All players / Games tabs with **region filter**
(All · four regions · Legacy), search (name, phone, email, city), verified filter, flagged-only, per-player games, disqualify /
reinstate, and CSV export (players, games, leaderboard — now with phone + region — and the region report).

## Deploying to Vercel

1. Import the repo (framework **Vite**; `vercel.json` sets build `npm run build`, output `dist`).
2. Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (optional `VITE_KNOW_MORE_URL`, `VITE_TERMS_URL`, `VITE_CAMPAIGN_DATES`).
3. Add `https://<your-domain>/**` to Supabase **Redirect URLs** (needed only for the `/admin` Google login).
4. Point the in-store **QR code** at the production URL.
5. Phone smoke test: QR → intro → *Sign In with OTP* → register → WhatsApp code → verify → play → leaderboard; then a private tab as guest → play → *Sign In with OTP* on the result screen.

## How scores are protected

Unchanged: `start-game` issues a server-chosen seed → the phone records Santa's moves → `finish-game` replays the whole game with
the shared engine and saves **its own** score (claimed score kept for audit only), flags faster-than-real-time games, saves each
session once and returns the stored result on retries. New: only **verified, registered** players can start a game; a phone
player without a profile gets 403 and is never auto-created.

Database: RLS everywhere; browser roles only **read** their own profile/games (column-limited, includes their phone and region);
no insert/update/delete anywhere; `anon` can do nothing. The leaderboard RPC returns only *rank · "First L." · score*.

## Testing

| Suite | Command | Needs |
|---|---|---|
| Unit (Vitest): engine parity with the original; phone rules; WATI request/response; **Standard Webhooks signature vector** | `npm test` | nothing |
| Live backend (RLS, scores, phone registration, regions, admin, OTP cap) | `npm run verify:backend` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Browser (Playwright, real Chrome): guest, OTP sign-in, guest→sign-in, signed-in, legacy, admin, responsive | `npm run test:e2e` | + `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` (for test OTPs); without them the OTP specs are skipped |

The service-role key and access token are read only from your shell. Real WhatsApp delivery is **not** exercised by the automated
tests (see `docs/WATI_OTP_REGIONS.md`).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | front end | project URL + public key |
| `VITE_KNOW_MORE_URL`, `VITE_TERMS_URL`, `VITE_CAMPAIGN_DATES` | front end, optional | intro copy |
| `WATI_API_TOKEN`, `WATI_API_BASE_URL`, `WATI_AUTH_TEMPLATE_NAME`, `WATI_AUTH_TEMPLATE_LANGUAGE` | Edge secrets (**never** the front end) | WhatsApp OTP delivery |
| `SEND_SMS_HOOK_SECRET` | Edge secret (generated by `configure-phone-auth.mjs`) | verifies Supabase's hook signature |
| `SEND_SMS_DRY_RUN`, `SEND_SMS_SKIP_NUMBERS` | Edge secrets, optional | staging / test-number safety |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (auto-injected) | server-side DB access |
| `BREVO_API_KEY` / `SMTP_*`, `EMAIL_FROM`, … | Edge secrets, optional | thank-you email (only for historical players who have an email) |

## Troubleshooting

- **"We couldn't send the WhatsApp code"** — check the Edge function logs for `send-sms`: `template` (not approved / wrong name or
  language), `auth` (WATI token), `network`. The number must be on WhatsApp.
- **Code arrives but the app errors** — the hook must answer with `Content-Type: application/json` and within 5 s.
- **"Please wait N seconds"** — Supabase allows one code per number per 60 s.
- **Admin says "No admin access"** — sign in with the authorised Google account (`marketingext@zopper.com`); WhatsApp-OTP players are never admins.
- **A returning player sees an old name/region** — by design: an existing profile is never overwritten at sign-in.
