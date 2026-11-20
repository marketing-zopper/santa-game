# Santa's Safe Catch · Zopper Christmas Challenge

In-store mobile game: swipe to move Santa and catch falling phones in his sack. This repo is the **React + Vite +
Supabase** version of the original game (`marketing-zopper/Santa-Safe-Catch`). The game itself — artwork, CSS, canvas
engine, rules, sounds — is the original, migrated unchanged. What changed is the technology underneath, sign-in, the
back end and the player journey.

```
 Scan QR → Loading → Introduction → Choose entry mode ─┬─ Google Sign-In ─┐
                                                       └─ Play as Guest ──┴→ Game Home → Start game
 → Game Over → Results ─┬─ Play again
                        └─ Leaderboard   (signed-in players only)
```

| | Signed in with Google | Guest |
|---|---|---|
| Gameplay, difficulty, scoring | identical | identical |
| Score saved | Yes — validated on the server, stored in Supabase | **No** — memory only, lost on refresh |
| Leaderboard / prizes | Yes | **None** — no button, no screen, no data |
| Database profile / history | Yes | **None** |
| Browser storage | sound preference, offline retry queue | **nothing** (no localStorage, sessionStorage, cookies) |
| Network calls to Supabase | yes | **none** |

## Contents
- [Architecture](#architecture) · [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [Supabase setup](#supabase-setup) (database, Edge Functions, secrets)
- [Google sign-in setup](#google-sign-in-setup)
- [Admin dashboard](#admin-dashboard)
- [Deploying to Vercel](#deploying-to-vercel)
- [How scores are protected](#how-scores-are-protected)
- [Testing](#testing)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

## Architecture

- **React 19 + Vite (JavaScript, no TypeScript, no UI framework).** React owns the screens, navigation, auth and the
  results; the Canvas game is an imperative class (`src/game/GameController.js`) with **one** `requestAnimationFrame`
  loop outside React. React is only called back on discrete events (score/lives changed, banner, countdown, pause,
  game over), never per frame. `destroy()` removes every listener and timer.
- **One engine, two runtimes.** `supabase/functions/_shared/engine.js` is the original deterministic engine (fixed 60
  ticks/s, seeded RNG). The browser imports it through `src/game/engine.js`; the `finish-game` Edge Function imports the
  very same file to re-play and validate every signed-in game.
- **Supabase Auth** (Google OAuth, PKCE) · **Postgres** (profiles, sessions, games; RLS on everything) · **Edge
  Functions** (`start-game`, `finish-game`, `admin`, plain JavaScript).
- **Vercel** hosts the static front end (`/` = game, `/admin` = dashboard).

## Repository layout

```
src/
  App.jsx                 journey state machine + bridge to the game
  game/                   GameController (canvas, input, FX), draw, sprites, audio, engine re-export
  screens/                Loading, Intro, EntryMode, Home, HowToPlay, Leaderboard, Pause, Results
  components/             Hud, Sheet, icons
  contexts/               AuthContext (Supabase session + profile), ToastContext
  services/               api (Edge Function calls), gameService (start/finish/leaderboard/retry queue), location
  lib/                    supabase client, campaign copy, safe storage
  styles/                 game.css (original CSS), entry.css (Entry Mode + small-phone fixes)
  admin/                  React admin dashboard + admin.css (original admin CSS)
public/                   original artwork (assets/) and Mona Sans font
supabase/
  migrations/             SQL: schema + RLS + functions; Google-only hardening
  functions/              start-game, finish-game, admin, _shared (engine, common, email)
  config.toml
tests/                    engine parity (Vitest) + browser tests (Playwright)
scripts/verify-backend.mjs  end-to-end check of the live Supabase backend
docs/MIGRATION.md         feature inventory, file mapping, parity checklist, decisions, test report
```

## Local setup

Requires Node 20+.

```bash
npm install
cp .env.example .env.local        # then fill in the two VITE_SUPABASE_* values
npm run dev                       # http://localhost:5173
```

The game also runs with **no** Supabase configuration at all: guest play works; the Google button is disabled with an
explanation. Open `http://localhost:5173/admin` for the dashboard.

Other scripts: `npm run build` · `npm run preview` · `npm test` (unit) · `npm run test:e2e` (browser) ·
`npm run verify:backend` (live backend checks).

## Supabase setup

You need a Supabase project (the migrations and functions in this repo are already applied to
`fyjovgxvyuynlgjjucut`; do the steps below for any new project).

### 1. Database

Run the migrations in order, either in the Supabase **SQL Editor** (paste each file and *Run*) or with the CLI:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npx supabase db push
```

| Migration | What it does |
|---|---|
| `20261120000001_core_schema.sql` | tables (`profiles`, `game_sessions`, `games`, `admin_users`, `email_log`), indexes, RLS, grants, auth trigger, leaderboard view, `touch_profile`, `get_leaderboard`, `start_session`, `record_game`, `admin_stats`, `admin_list` |
| `20261120000002_google_only.sql` | "verified" now means *Google-verified*: only Google accounts can start games, rank, or use the admin dashboard — even if the Email provider is left on |

### 2. Edge Functions

```bash
npx supabase functions deploy --project-ref <ref> --use-api     # start-game, finish-game, admin
```

They are deployed with `verify_jwt = false` (see `supabase/config.toml`) and verify the caller's access token
themselves (`auth.getUser`), which works with any JWT signing key. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by Supabase — **never** put the service-role key in the front end or in this repo.

### 3. Edge Function secrets (all optional)

Only needed for the first-game thank-you email. Without them nothing is sent and everything else works.

```bash
npx supabase secrets set --project-ref <ref> \
  BREVO_API_KEY=... EMAIL_FROM=christmas@your-domain.com EMAIL_FROM_NAME="Zopper Christmas Challenge" \
  GAME_URL=https://your-game-url KNOW_MORE_URL=https://... TERMS_URL=https://... CAMPAIGN_END="31 December 2026"
```

SMTP instead of Brevo: `SMTP_HOST`, `SMTP_PORT` (**use 465** — Supabase Edge Functions block outbound ports 25 and 587),
`SMTP_USER`, `SMTP_PASS`. `SKIP_TIME_CHECK=1` disables the faster-than-real-time check (testing only).

### 4. Auth configuration

Dashboard → **Authentication**:
- *URL Configuration* → **Site URL** = your production URL; **Redirect URLs** add `https://your-game-url/**`,
  `https://your-game-url/admin`, and for local work `http://localhost:5173/**`.
- *Providers* → **Google** enabled (next section). **Anonymous sign-ins stay OFF** — guests must have no database presence.
- Recommended hardening: *Providers → Email → disable*. (Not required for safety — see migration 2 — but it removes a
  pointless sign-up route.)

## Google sign-in setup

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → OAuth consent screen**: set the app
   name, support email and authorised domains. Set the publishing status to **In production** before the campaign (in
   *Testing* only listed test users can sign in).
2. **Credentials → OAuth client ID → Web application**:
   - **Authorised redirect URIs** → `https://<project-ref>.supabase.co/auth/v1/callback`
     (this project: `https://fyjovgxvyuynlgjjucut.supabase.co/auth/v1/callback`).
     **Without this exact entry Google answers `Error 400: redirect_uri_mismatch`.**
   - Authorised JavaScript origins → your production URL (and `http://localhost:5173` for development).
3. Supabase Dashboard → **Authentication → Providers → Google** → enable, paste the **Client ID** and **Client Secret**
   (or `PATCH /v1/projects/<ref>/config/auth` with `external_google_*`). The secret lives only in Supabase.
4. Scopes `openid email profile` are the defaults and are all the game needs.

## Admin dashboard

`/admin` — Google sign-in, then the `admin` Edge Function checks the account's verified email against
`public.admin_users`. There is no shared password any more. Add the first admin (SQL editor):

```sql
insert into public.admin_users (email) values ('someone@your-company.com');   -- lower-case
```

Everything from the original dashboard is kept: KPIs, players/games per day, players by city, Leaderboard / All players /
Games tabs, search, verified filter, flagged-only, per-player games, CSV export, disqualify / reinstate. Obsolete pieces
(mobile number, email-OTP stats, DB-health/migrate tools) are gone because those features no longer exist. Guest games
never reach the database, so they cannot appear in any admin view or export.

## Deploying to Vercel

1. Push this repo to GitHub, then Vercel → **Add New → Project** → import it. Framework preset **Vite** (auto-detected;
   `vercel.json` sets build `npm run build`, output `dist`).
2. **Environment Variables** (Production + Preview): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   (optionally `VITE_KNOW_MORE_URL`, `VITE_TERMS_URL`, `VITE_CAMPAIGN_DATES`).
3. Deploy, then add the live URL to Supabase **Site URL / Redirect URLs** and Google **Authorised JavaScript origins**
   (see above) and update the `GAME_URL` function secret.
4. Point the in-store **QR code** at the production URL.
5. Smoke test on a phone: open the link → intro → *Sign in with Google* → Game Home → play → results → leaderboard;
   then in a private tab *Play as Guest*.

## How scores are protected

The original anti-cheat model is preserved and now runs in a Supabase Edge Function:

1. `start-game` (signed-in only) — the **server** picks the random seed and stores a one-time session.
2. The phone plays the game and records Santa's target positions (`[tick, x, …]`).
3. `finish-game` re-plays the entire game from the server's seed + those moves with the same engine, and saves **its own**
   score. The phone's claimed score is stored for audit only (a mismatch is noted).
4. A game that took less real time than its in-game time (faster than real time) is **flagged** and never counts.
5. Each session saves once; a retried request returns the stored result (no duplicates); start is rate-limited (12/min).

Database: RLS on every table; browser roles can only **read** their own profile/games (column-limited) — no insert,
update or delete anywhere. `anon` (guests) can do nothing at all. The leaderboard RPC returns only
*rank · "First L." · score* and only to signed-in Google players. Service-role keys exist only inside Supabase.

## Testing

| Suite | Command | Needs |
|---|---|---|
| Engine parity (42): same scores / state / constants as the **original** engine via golden fixtures | `npm test` | nothing |
| Live backend (54): RLS, tamper, retry, rate limit, leaderboard privacy, admin authz | `npm run verify:backend` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| Browser (Playwright, real Chrome): guest, signed-in, admin, responsive | `npm run test:e2e` | Chrome; signed-in/admin specs also need `SUPABASE_SERVICE_ROLE_KEY` (else skipped) |

The service-role key is only ever read from your shell environment by the tests (to create temporary test users that are
deleted afterwards). A real Google consent screen cannot be automated, so E2E injects a genuine Supabase session for a
temporary user — everything after the OAuth redirect is exercised. See `docs/MIGRATION.md` for results and what could
not be tested.

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | front end (Vercel / `.env.local`) | project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | front end | public publishable (anon) key |
| `VITE_KNOW_MORE_URL`, `VITE_TERMS_URL`, `VITE_CAMPAIGN_DATES` | front end, optional | intro-screen copy |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions (auto-injected) | server-side DB access |
| `BREVO_API_KEY` or `SMTP_*`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `GAME_URL`, `KNOW_MORE_URL`, `TERMS_URL`, `CAMPAIGN_END` | Edge Function secrets, optional | thank-you email |
| `SKIP_TIME_CHECK` | Edge Function secret | testing only |

## Troubleshooting

- **`Error 400: redirect_uri_mismatch` at Google** → add `https://<ref>.supabase.co/auth/v1/callback` to the OAuth
  client's *Authorised redirect URIs*.
- **Back from Google but not signed in / "requested path is invalid"** → the page URL is missing from Supabase
  *Redirect URLs*.
- **"Access blocked: app has not completed verification"** → consent screen is still in *Testing*; publish it or add the user.
- **Signed-in round says "Practice round"** → the Edge Functions are unreachable or not deployed.
- **"Round not counted"** → the server judged the round faster than real time (or tampered).
- **Admin says "No admin access"** → the account is not Google-verified or its lower-case email isn't in `admin_users`.
