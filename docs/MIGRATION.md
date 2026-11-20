# Migration report — Santa's Safe Catch → React + Vite + Supabase

| | |
|---|---|
| Source repository (read-only) | `marketing-zopper/Santa-Safe-Catch` |
| **Source commit migrated** | `ce318326f22c1e290ba3a805251a5f888314239c` — *"Redesign: new screens, Mona Sans, supplied artwork for Santa, phones, shield and background"* |
| Destination | `marketing-zopper/santa-game`, branch `feature/react-supabase-migration` |
| Approved journey | the flow screenshot supplied with the brief (Scan QR → Loading → Introduction → Choose entry mode → Game Home → Start game → Game Over → Results) |

The source repository was only cloned and read; nothing in it was edited, committed or pushed. No secrets, `.env` files
or player data were copied (the source repo contained none).

## 1. What the original was

| Part | Original | Notes |
|---|---|---|
| Front end | one 1,214-line `index.html`: inline CSS, DOM screens, imperative Canvas game | engine inlined a second time (identical to `engine.js`) |
| Engine | `engine.js` — deterministic, fixed 60 ticks/s, seeded xorshift RNG, `replay(seed, inputs, endTick)` | the anti-cheat foundation |
| Back end | Vercel functions on raw `pg`: `start`, `finish`, `leaderboard`, `otp-send`, `otp-verify`, `admin`, `health`, `_email`, `_lib`, `_migration002` | HMAC player tokens; shared admin password (switched off) |
| Database | Supabase Postgres used only as a database: `players`, `game_sessions`, `games`, `otp_codes`, `email_log`, `leaderboard` view, `record_game` / `player_standing` / `admin_stats` | RLS on, no policies — API-only access |
| Admin | `admin.html` — KPIs, 2 bar charts, city list, Leaderboard/Players/Games tabs, search, verified filter, flagged filter, per-player games, disqualify, CSV export | |
| Assets | 11 `.webp` (logo, background, Santa + sack, 4 phones, shield, gauge, panel header, relaxed Santa), Mona Sans `woff2`; two large PNGs (`santa-sack-transparent.png`, `santa-sleigh-transparent.png`) | the two PNGs are referenced nowhere — not copied |

Existing Supabase integration evaluated: the **tables, ranking rules, `record_game` atomic save, `admin_stats` and the
seed/replay protocol were reused** (adapted to `auth.users`); the `pg` connection-string access, HMAC tokens, OTP and
mailer plumbing were replaced.

## 2. Feature inventory → disposition

| Original feature | Disposition in the new app |
|---|---|
| Loading screen (logo, bar, tips, 1.3 s min, 4 s timeout) | **Migrated** (`LoadingScreen`); additionally waits for the stored session to resolve |
| Introduction (how it works, prizes, dates, Know more, T&Cs) | **Migrated**; Continue now opens Entry Mode |
| Sign-up form (name, email, mobile, consent) + email OTP + "log in on another phone" | **Replaced** by Google Sign-In / Guest (approved journey) |
| Game Home (attract-mode Santa, best chip, mute, PLAY, How to play, Leaderboard, player chip) | **Migrated**; chip/leaderboard are mode-specific |
| How to play sheet | **Migrated** (pixel-identical) |
| Canvas gameplay (movement, falling phones, gold ×4, coal, shield, scoring, lives, difficulty, spawn, countdown, pause/resume, end game, FX, shake, flash, snow, particles, haptics, wake-lock) | **Migrated** unchanged (`GameController` + shared engine) |
| Synth audio (catch/gold/miss/coal/shield/over/countdown) + mute | **Migrated**; mute remembered for signed-in players only |
| Game Over + stats + Zopper promo + Play again / Main menu | **Migrated** as Game Over → Results (see §6) |
| Leaderboard sheet (top 10, crowns, "you" card) | **Migrated**; signed-in only; names shown as "First L." by the database |
| Server seed + replay validation, flags, single-use sessions, rate limit | **Migrated** to Edge Functions; retries now idempotent |
| Offline retry queue for unsent scores | **Migrated**, signed-in players only, now per player |
| Location (GPS + city) | **Kept, signed-in only**: asked once on Game Home, sent with the finished game, shown in admin |
| First-game thank-you email | **Kept, optional** (Brevo/SMTP via Edge Function secrets); *not exercised* — no provider credentials |
| Admin dashboard (all panels, tabs, filters, search, per-player games, disqualify, CSV) | **Migrated** (React) with Google + allow-list auth |
| Admin: mobile column, OTP/e-mail stats, health/migrate/test-email tools | **Removed / adapted** — the mobile number, OTP and DATABASE_URL no longer exist. `test-email` and a health view of integration settings remain |
| `players.phone`, `otp_codes`, `verified_at`-by-OTP | **Removed**; "verified" = Google-verified email |
| Practice mode when the server is unreachable | **Kept** (signed-in players; clearly labelled, not saved) |

## 3. File mapping

| Original | New |
|---|---|
| `index.html` (CSS) | `src/styles/game.css` (verbatim; asset URLs → `/assets`, OTP-form rules dropped) |
| `index.html` (markup) | `src/screens/*`, `src/components/*` |
| `index.html` (game script) | `src/game/GameController.js`, `draw.js`, `sprites.js`, `audio.js`; UI flow in `src/App.jsx` |
| `engine.js` | `supabase/functions/_shared/engine.js` (only `export` keywords added) → re-exported by `src/game/engine.js` |
| `admin.html` | `admin.html` + `src/admin/AdminApp.jsx` + `src/admin/admin.css` (verbatim) |
| `api/start.js`, `api/finish.js` | `supabase/functions/start-game`, `finish-game` |
| `api/leaderboard.js` | SQL function `get_leaderboard()` (RPC, signed-in only) |
| `api/admin.js` | `supabase/functions/admin` + SQL `admin_list()` / `admin_stats()` |
| `api/_email.js` (thanks email) | `supabase/functions/_shared/email.js` |
| `api/otp-send.js`, `otp-verify.js`, `health.js`, `_migration002.js`, `_lib.js` | replaced by Supabase Auth / dropped |
| `supabase/schema.sql`, `002_otp_email.sql` | `supabase/migrations/…001_core_schema.sql`, `…002_google_only.sql` |
| `assets/*`, `fonts/*` | `public/assets/*`, `public/fonts/*` (copied byte-for-byte) |
| `vercel.json` | `vercel.json` (Vite build, cache + security headers) |

## 4. The new journey, as implemented

| Step (screenshot) | Implementation |
|---|---|
| 1 Scan QR | the production URL; `redirectTo` returns to `/` |
| 2 Loading | `LoadingScreen`; waits for assets + session |
| 3 Introduction | `IntroScreen` |
| 4 Choose entry mode | `EntryModeScreen` — **Google Sign-In** (scores saved) / **Play as Guest** (no score saving) |
| 5 Game Home | `HomeScreen`; signed-in: Leaderboard + "Playing as <name> · Sign out"; guest: no leaderboard, "Playing as Guest · Sign in" |
| 6 Start game | countdown 3-2-1 + play (`GameController`) |
| 7 Game Over | HUD + "Game over" banner for 0.9 s (the original's pause before its result panel) |
| 8 Results | `ResultsScreen`: signed-in → *Score synced*, Play again + Leaderboard; guest → *not saved*, Play again only |

A **valid stored session skips steps 3–4** (the original also skipped the intro for returning players).

## 5. Security model

- Guests never authenticate. The `anon` role has **no** table or function privileges (verified).
- Signed-in players: RLS limits reads to their own row; **no** insert/update/delete grants or policies exist for browser
  roles, so scores cannot be written or altered from the browser (verified, including an attempted `best_score` update).
- Scores only change through `record_game()`, callable by `service_role` only, from `finish-game` after the replay.
- Leaderboard RPC: signed-in verified players only; returns *rank / "First L." / score*; never e-mails or ids.
- Admin: Google identity **and** `admin_users` allow-list, checked server-side on every call. Non-Google accounts are
  refused even if their email is allow-listed.
- Email/password sign-ups (if the Email provider is left on) can't reach the game or admin: "verified" requires Google.
- Secrets: the service-role key exists only inside Supabase; the Google client secret only in Supabase Auth config;
  nothing sensitive is in git (`.gitignore` blocks `.env*`; a scan of the tree found none).

## 6. Deliberate differences from the original (everything else is unchanged)

1. Sign-up / OTP flow replaced by Entry Mode (required by the brief).
2. Results panel tag reads **"Round results"** (was "Game over"); result-card copy is mode-specific; flagged rounds say "Round not counted".
3. **"Main menu" button kept on Results** (original element). The approved flow lists only Play again / Leaderboard as exits; Main menu is needed to reach Sign out / entry. Remove `#homeBtn` in `ResultsScreen.jsx` if you want a strict match.
4. Guest chip says "Sign in" and opens Entry Mode (instead of the old "Switch player").
5. Two narrow-screen CSS fixes (≤ 340 px intro bar; ≤ 360 px Entry cards) — the original's intro bar overflowed on a 320 px phone. Wider layouts are untouched (pixel-verified).
6. Location is requested once on Game Home for signed-in players (the original asked at sign-up). Guests are never asked.
7. Contact details: winners are contacted via their Google email (no mobile number is collected any more).
8. Dead code not ported: the unused `hills()/cottage()/tree()` canvas helpers and `dr()` RNG, the unreferenced `santa-*-transparent.png` files, `engine.tier` sound is kept.
9. **Gameplay change (requested after the migration): catch zone +10%** — `CATCH_HALF` 34 → 37.4 (overall width 68 → 74.8) in the shared engine, so browser and server validation agree. Santa and his sack are also drawn 12% larger (visual only). The parity tests now compare against the original engine with exactly this one constant patched.
10. `lb-list li.me` CSS exists in the original but was never applied; it still isn't.

## 7. Verification

| Suite | Result |
|---|---|
| Engine parity (Vitest, 42 tests): original `engine.js` (with only CATCH_HALF patched to 37.4) run on 8 seeds → golden fixtures; migrated engine must match scores, catches, durations, mid-game world state (ticks 300/1200/3000), all constants and difficulty curves; browser and server import the same module | **42 / 42 pass** |
| Live backend (`scripts/verify-backend.mjs`, 54 checks): guest lock-out, RLS, no score writes, server-computed score wins, tamper flag, retry idempotence, faster-than-real-time flag, ownership, input validation, rate limit, leaderboard privacy, admin authz/search/CSV/disqualify, non-Google accounts | **54 / 54 pass** |
| Browser (Playwright, real Chrome, mobile viewport + touch): 32 tests — details below | **32 / 32 pass** |
| Visual parity vs the running original (390×844 @2×, animations frozen, canvas hidden → DOM/CSS only): Introduction, intro action bar, Game Home, How to play, Pause, Results promo card | **0.000 % pixels differ** |
| Leaderboard sheet (same mocked data) | 0.74 % — the "you" card showed a different mocked best value; layout identical |
| Results score / stats | values differ only because each app played a different random game; type, tiles and spacing identical |
| Canvas gameplay frames | **inspected visually only** (random seeds make pixel diffs meaningless); code is a verbatim port and the engine is proven identical by the golden tests |

Browser specs: **guest** (journey, back, no leaderboard anywhere, 3 consecutive replays, single animation loop ≈ 60 fps,
in-memory best, zero storage/cookies/Supabase traffic, pause/resume/end by button and keyboard, touch swipe + keyboard
controls, audio unlock/countdown/mute, Google button → Supabase PKCE redirect, OAuth error return), **signed-in**
(returning session → Home, server-issued session + validated score + rank, leaderboard privacy, replays, reload restores
best, tampered submission, lost-response retry without duplicates, sign-out), **admin** (signed-out, non-admin refused,
allow-listed admin full tour incl. CSV and disqualify), **responsive** (320 … 1280 px, rotation, uniform canvas scale).

A defect found and fixed *by* these tests: the admin table briefly rendered the previous tab's rows under the new tab's actions (a stale games row could be sent to "Disqualify"); data is now tagged with its tab and only the latest request may update the screen. Also found and fixed: the Leaderboard opened from Results rendered *behind* it (z-order), and a 320 px overflow.

## 8. Not tested / blockers

- **Real Google sign-in end to end.** Google currently answers `redirect_uri_mismatch` for this OAuth client: add
  `https://fyjovgxvyuynlgjjucut.supabase.co/auth/v1/callback` to its *Authorised redirect URIs* (Google Cloud → Credentials).
  A consent screen can't be automated anyway; tests inject a genuine Supabase session instead.
- **Thank-you email** (Brevo/SMTP) — no provider credentials, so sending is untested.
- **Production deployment on Vercel** — not deployed from here; the production build and `vite preview` were tested.
- **Real devices** (iOS Safari / Android Chrome), real audio output, haptics, wake-lock and GPS accuracy — emulated Chrome only.
- **Load / concurrency** beyond the rate-limit and duplicate-submit tests.
- **Admin first-user bootstrap** — no admin email was added (needs a decision); see README.
