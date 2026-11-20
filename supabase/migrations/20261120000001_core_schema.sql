-- Santa's Safe Catch · core schema (Supabase Auth + Postgres)
--
-- Security model
--   * Players are Supabase Auth users (Google). A `profiles` row is created automatically for each.
--   * Guests have NO database presence: they never authenticate, so RLS gives the `anon` role nothing at all.
--   * Signed-in players can only READ their own profile / games. Nobody but the server (service_role, used by the
--     Edge Functions) can insert or update game_sessions / games / scores. Scores are re-played server-side.
--   * Every function below is locked down with explicit grants; nothing is executable by `public`.
--
-- Safe to run more than once.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

-- One row per signed-in player. id == auth.users.id
create table if not exists public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  display_name        text not null default 'Player' check (char_length(display_name) between 1 and 120),
  email               text,
  avatar_url          text,
  email_verified      boolean not null default false,     -- Google accounts arrive verified
  consent_at          timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  -- location: GPS if the player allowed it (sent with a finished game), else nothing
  lat                 double precision,
  lng                 double precision,
  location_accuracy_m real,
  location_source     text check (location_source in ('gps', 'network')),
  city                text,
  region              text,
  country             text,
  ip_city             text,
  ip_region           text,
  ip_country          text,
  user_agent          text,
  -- scores (only ever written by record_game())
  best_score          integer not null default 0,
  best_at             timestamptz,
  games_played        integer not null default 0,
  total_score         bigint  not null default 0,
  disqualified        boolean not null default false,
  thanks_sent_at      timestamptz,                         -- first-game thank-you email
  notes               text
);

-- One row per game started. The SERVER picks the random seed so the finished game can be re-played and checked.
create table if not exists public.game_sessions (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.profiles (id) on delete cascade,
  seed       bigint not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz
);

-- One row per finished (and validated) game
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.profiles (id) on delete cascade,
  session_id    uuid not null unique references public.game_sessions (id) on delete cascade,
  score         integer not null,          -- re-computed by the server from the recorded moves
  client_score  integer,                   -- what the phone reported (audit only)
  duration_s    real,
  phones_caught integer,
  flagged       boolean not null default false,
  flag_reason   text,
  lat           double precision,
  lng           double precision,
  city          text,
  ip_city       text,
  user_agent    text,
  created_at    timestamptz not null default now()
);

-- Who may use the admin dashboard (matched on the verified email of the signed-in Google account)
create table if not exists public.admin_users (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

-- Every email the game sends (thank-you email); kept for the admin dashboard
create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid references public.profiles (id) on delete set null,
  kind        text not null,
  to_email    text not null,
  status      text not null,               -- 'sent' | 'failed'
  provider_id text,
  error       text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------------------------------------------
create index if not exists profiles_rank_idx      on public.profiles (best_score desc, best_at asc) where best_score > 0 and not disqualified;
create index if not exists profiles_created_idx   on public.profiles (created_at desc);
create index if not exists profiles_email_idx     on public.profiles (lower(email));
create index if not exists sessions_player_idx    on public.game_sessions (player_id, created_at desc);
create index if not exists games_player_idx       on public.games (player_id, created_at desc);
create index if not exists games_created_idx      on public.games (created_at desc);
create index if not exists games_flagged_idx      on public.games (created_at desc) where flagged;
create index if not exists email_log_created_idx  on public.email_log (created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- Row Level Security + grants
-- ---------------------------------------------------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.game_sessions enable row level security;
alter table public.games         enable row level security;
alter table public.admin_users   enable row level security;
alter table public.email_log     enable row level security;

-- Start from nothing for the browser roles, then grant back the minimum.
revoke all on public.profiles, public.game_sessions, public.games, public.admin_users, public.email_log from anon, authenticated;

-- A signed-in player may read ONLY their own profile, and only these columns (no notes, flags or IP data).
grant select (id, display_name, avatar_url, best_score, best_at, games_played, total_score, created_at, last_seen_at)
  on public.profiles to authenticated;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- ...and their own game history. No insert / update / delete policy exists for anyone, so the browser can never
-- write or alter a score; only the service role (Edge Functions) can.
grant select (id, player_id, score, duration_s, phones_caught, created_at) on public.games to authenticated;
drop policy if exists games_select_own on public.games;
create policy games_select_own on public.games
  for select to authenticated using (player_id = (select auth.uid()));

-- game_sessions, admin_users, email_log: no policies and no grants for browser roles => completely private.
grant select, insert, update, delete on public.profiles, public.game_sessions, public.games, public.admin_users, public.email_log to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Profile creation: a trigger on auth.users makes the profile the moment someone signs in with Google
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, display_name, email, avatar_url, email_verified)
  values (
    new.id,
    left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Player'), 120),
    new.email,
    coalesce(meta ->> 'avatar_url', meta ->> 'picture'),
    coalesce((meta ->> 'email_verified')::boolean, new.email_confirmed_at is not null, false)
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- never block a sign-in because the profile insert failed; touch_profile() repairs it on first load
  raise warning 'handle_auth_user failed: %', sqlerrm;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_auth_user();

-- "First name + last initial" — the only form of a player's name that other players ever see
create or replace function public.short_name(n text)
returns text language sql immutable set search_path = public as $$
  with p as (select regexp_split_to_array(btrim(coalesce(n, '')), '\s+') as w)
  select case
    when array_length(w, 1) > 1 then w[1] || ' ' || upper(left(w[array_length(w, 1)], 1)) || '.'
    when w[1] = '' then 'Player'
    else w[1] end
  from p;
$$;

-- Ranked = has a score, not disqualified, verified email. Ties: whoever reached the score first ranks higher.
create or replace view public.leaderboard with (security_invoker = true) as
  select row_number() over (order by best_score desc, best_at asc) as rank, p.*
  from public.profiles p
  where best_score > 0 and not disqualified and email_verified;

create or replace function public.player_standing(p_player uuid)
returns table (out_best integer, out_rank bigint, out_total bigint)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select id, row_number() over (order by best_score desc, best_at asc) as rk
    from profiles where best_score > 0 and not disqualified and email_verified
  )
  select p.best_score, ranked.rk, (select count(*) from ranked)
  from profiles p left join ranked on ranked.id = p.id
  where p.id = p_player;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Client-callable (authenticated only)
-- ---------------------------------------------------------------------------------------------------------------

-- Called by the app right after sign-in / on every load of a signed-in session.
-- Creates the profile if it is somehow missing, refreshes name / avatar from Google, and returns the standing.
create or replace function public.touch_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  u auth.users%rowtype;
  meta jsonb;
  st record;
  prof public.profiles%rowtype;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into u from auth.users where id = uid;
  if not found then raise exception 'not_authenticated' using errcode = '28000'; end if;
  meta := coalesce(u.raw_user_meta_data, '{}'::jsonb);

  insert into public.profiles (id, display_name, email, avatar_url, email_verified)
  values (uid,
    left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Player'), 120),
    u.email, coalesce(meta ->> 'avatar_url', meta ->> 'picture'),
    coalesce((meta ->> 'email_verified')::boolean, u.email_confirmed_at is not null, false))
  on conflict (id) do update set
    display_name = excluded.display_name,
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    email_verified = excluded.email_verified or public.profiles.email_verified,
    last_seen_at = now()
  returning * into prof;

  select * into st from public.player_standing(uid);
  return jsonb_build_object(
    'id', prof.id, 'name', prof.display_name, 'avatar_url', prof.avatar_url,
    'best', coalesce(st.out_best, 0), 'rank', st.out_rank, 'total', coalesce(st.out_total, 0),
    'games_played', prof.games_played);
end $$;

-- In-game leaderboard: top players as "First L." + score, plus the caller's own standing.
-- Only signed-in players can call it, so guests can never read leaderboard data.
create or replace function public.get_leaderboard(p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  with ranked as (
    select id, display_name, best_score, row_number() over (order by best_score desc, best_at asc) as rk
    from profiles where best_score > 0 and not disqualified and email_verified
  )
  select jsonb_build_object(
    'total', (select count(*) from ranked),
    'top',   (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', short_name(display_name), 'score', best_score) order by rk), '[]'::jsonb)
              from ranked where rk <= greatest(1, least(coalesce(p_limit, 10), 50))),
    'me',    (select jsonb_build_object('rank', rk, 'name', short_name(display_name), 'best', best_score) from ranked where id = auth.uid())
  )
  where auth.uid() is not null;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Server-only (service_role: called by the Edge Functions)
-- ---------------------------------------------------------------------------------------------------------------

-- Begin an authorised game: store the server-chosen seed. Max 12 games started per minute per player.
create or replace function public.start_session(p_player uuid, p_seed bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  perform 1 from profiles where id = p_player;
  if not found then raise exception 'unknown_player'; end if;
  if (select count(*) from game_sessions where player_id = p_player and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'rate_limited';
  end if;
  insert into game_sessions (player_id, seed) values (p_player, p_seed) returning id into sid;
  return sid;
end $$;

-- Save a finished game atomically: burn the session, store the game, update the player's best.
create or replace function public.record_game(
  p_player uuid, p_session uuid, p_score integer, p_client_score integer,
  p_duration real, p_caught integer, p_flagged boolean, p_flag_reason text,
  p_lat double precision, p_lng double precision, p_accuracy real, p_city text, p_region text, p_country text,
  p_ip_city text, p_ua text)
returns table (out_best integer, out_rank bigint, out_total bigint)
language plpgsql security definer set search_path = public as $$
begin
  update game_sessions set used_at = now()
   where id = p_session and player_id = p_player and used_at is null;
  if not found then raise exception 'session_used_or_missing'; end if;

  insert into games (player_id, session_id, score, client_score, duration_s, phones_caught,
                     flagged, flag_reason, lat, lng, city, ip_city, user_agent)
  values (p_player, p_session, p_score, p_client_score, p_duration, p_caught,
          p_flagged, p_flag_reason, p_lat, p_lng, p_city, p_ip_city, p_ua);

  update profiles set
    games_played = games_played + 1,
    total_score  = total_score + p_score,
    last_seen_at = now(),
    best_at      = case when not p_flagged and p_score > best_score then now() else best_at end,
    best_score   = case when not p_flagged then greatest(best_score, p_score) else best_score end,
    lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng),
    location_accuracy_m = case when p_lat is not null then p_accuracy else location_accuracy_m end,
    location_source = case when p_lat is not null then 'gps' else location_source end,
    city = coalesce(p_city, city), region = coalesce(p_region, region), country = coalesce(p_country, country),
    ip_city = coalesce(p_ip_city, ip_city), user_agent = coalesce(p_ua, user_agent)
  where id = p_player;

  return query select * from player_standing(p_player);
end $$;

-- Result of an already-saved game (lets a retried finish call return the same answer instead of failing)
create or replace function public.saved_game_result(p_player uuid, p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('score', g.score, 'caught', g.phones_caught, 'duration_s', g.duration_s, 'flagged', g.flagged,
                            'best', st.out_best, 'rank', st.out_rank, 'total', st.out_total)
  from games g left join lateral player_standing(g.player_id) st on true
  where g.session_id = p_session and g.player_id = p_player;
$$;

-- Numbers for the admin dashboard
create or replace function public.admin_stats(p_tz text default 'Asia/Kolkata')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'players',        (select count(*) from profiles),
    'verified',       (select count(*) from profiles where email_verified),
    'players_today',  (select count(*) from profiles where (created_at at time zone p_tz)::date = (now() at time zone p_tz)::date),
    'games',          (select count(*) from games),
    'games_today',    (select count(*) from games where (created_at at time zone p_tz)::date = (now() at time zone p_tz)::date),
    'top_score',      (select coalesce(max(best_score), 0) from profiles where not disqualified and email_verified),
    'avg_score',      (select coalesce(round(avg(score)), 0) from games where not flagged),
    'flagged_games',  (select count(*) from games where flagged),
    'located_gps',    (select count(*) from profiles where location_source = 'gps'),
    'emails_sent',    (select count(*) from email_log where status = 'sent'),
    'emails_failed',  (select count(*) from email_log where status = 'failed'),
    'thanks_sent',    (select count(*) from profiles where thanks_sent_at is not null),
    'by_city',        (select coalesce(jsonb_agg(c order by (c ->> 'players')::int desc), '[]'::jsonb) from (
                         select jsonb_build_object('city', coalesce(city, ip_city, 'Unknown'), 'players', count(*)::int, 'top', max(best_score)) as c
                         from profiles group by coalesce(city, ip_city, 'Unknown') order by count(*) desc limit 15) x),
    'by_day',         (select coalesce(jsonb_agg(d order by d ->> 'day'), '[]'::jsonb) from (
                         select jsonb_build_object('day', day, 'players', coalesce(pc, 0), 'games', coalesce(gc, 0)) as d from (
                           select gs::date as day,
                             (select count(*) from profiles where (created_at at time zone p_tz)::date = gs::date) as pc,
                             (select count(*) from games    where (created_at at time zone p_tz)::date = gs::date) as gc
                           from generate_series((now() at time zone p_tz)::date - 29, (now() at time zone p_tz)::date, interval '1 day') gs) z) y)
  );
$$;

-- Admin lists. p_verified: 'all' | 'yes' | 'no'. p_limit null => everything (CSV export).
create or replace function public.admin_list(
  p_kind text, p_q text default '', p_verified text default 'all', p_flagged boolean default false,
  p_player uuid default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pat text := case when btrim(coalesce(p_q, '')) = '' then null
                   else '%' || replace(replace(replace(left(btrim(p_q), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  lim integer := case when p_limit is null then null else greatest(1, least(p_limit, 500)) end;
  off integer := greatest(0, coalesce(p_offset, 0));
  out jsonb;
begin
  if p_kind = 'leaderboard' then
    -- positions are counted within the chosen group; official_rank is the prize ranking (verified only)
    with ranked as (
      select row_number() over (order by p.best_score desc, p.best_at asc nulls last) as rank, p.*
      from profiles p
      where p.best_score > 0 and not p.disqualified
        and (p_verified = 'all' or (p_verified = 'yes' and p.email_verified) or (p_verified = 'no' and not p.email_verified))
    ), filt as (
      select r.*, l.rank as official_rank from ranked r left join leaderboard l on l.id = r.id
      where pat is null or r.display_name ilike pat or r.email ilike pat or coalesce(r.city, r.ip_city, '') ilike pat
    )
    select jsonb_build_object(
      'total', (select count(*) from filt),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'notes' - 'user_agent') from (select * from filt order by rank limit lim offset off) x), '[]'::jsonb)) into out;
  elsif p_kind = 'players' then
    with filt as (
      select l.rank, p.* from profiles p left join leaderboard l on l.id = p.id
      where (p_verified = 'all' or (p_verified = 'yes' and p.email_verified) or (p_verified = 'no' and not p.email_verified))
        and (pat is null or p.display_name ilike pat or p.email ilike pat or coalesce(p.city, p.ip_city, '') ilike pat)
    )
    select jsonb_build_object(
      'total', (select count(*) from filt),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'notes' - 'user_agent') from (select * from filt order by created_at desc limit lim offset off) x), '[]'::jsonb)) into out;
  elsif p_kind = 'games' then
    with filt as (
      select g.id, g.created_at, g.score, g.client_score, g.duration_s, g.phones_caught, g.flagged, g.flag_reason,
             g.city, g.ip_city, g.lat, g.lng, g.player_id, p.display_name, p.email, p.email_verified
      from games g join profiles p on p.id = g.player_id
      where (p_verified = 'all' or (p_verified = 'yes' and p.email_verified) or (p_verified = 'no' and not p.email_verified))
        and (pat is null or p.display_name ilike pat or p.email ilike pat or coalesce(p.city, p.ip_city, '') ilike pat)
        and (not p_flagged or g.flagged)
        and (p_player is null or g.player_id = p_player)
    )
    select jsonb_build_object(
      'total', (select count(*) from filt),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (select * from filt order by created_at desc limit lim offset off) x), '[]'::jsonb)) into out;
  else
    raise exception 'unknown_kind';
  end if;
  return out;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Function grants: nothing executable by default
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.handle_auth_user()                          from public, anon, authenticated;
revoke all on function public.short_name(text)                            from public, anon, authenticated;
revoke all on function public.player_standing(uuid)                       from public, anon, authenticated;
revoke all on function public.touch_profile()                             from public, anon, authenticated;
revoke all on function public.get_leaderboard(integer)                    from public, anon, authenticated;
revoke all on function public.start_session(uuid, bigint)                 from public, anon, authenticated;
revoke all on function public.record_game(uuid, uuid, integer, integer, real, integer, boolean, text, double precision, double precision, real, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.saved_game_result(uuid, uuid)               from public, anon, authenticated;
revoke all on function public.admin_stats(text)                           from public, anon, authenticated;
revoke all on function public.admin_list(text, text, text, boolean, uuid, integer, integer) from public, anon, authenticated;
revoke all on public.leaderboard                                          from public, anon, authenticated;

grant execute on function public.touch_profile()          to authenticated;
grant execute on function public.get_leaderboard(integer) to authenticated;

grant execute on function public.short_name(text)         to service_role;
grant execute on function public.player_standing(uuid)    to service_role;
grant execute on function public.start_session(uuid, bigint) to service_role;
grant execute on function public.record_game(uuid, uuid, integer, integer, real, integer, boolean, text, double precision, double precision, real, text, text, text, text, text) to service_role;
grant execute on function public.saved_game_result(uuid, uuid) to service_role;
grant execute on function public.admin_stats(text)        to service_role;
grant execute on function public.admin_list(text, text, text, boolean, uuid, integer, integer) to service_role;
grant select on public.leaderboard to service_role;
