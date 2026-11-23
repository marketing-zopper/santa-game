-- WhatsApp-OTP (phone) players + Croma region data.
--
-- ADDITIVE and non-destructive: every existing profile, session and game is kept exactly as it is.
--   * Historical Google players stay as they are (auth_provider = 'google', region = NULL = "legacy / unknown").
--     No region is invented for them and they are NOT merged with phone accounts.
--   * New players sign in with a phone number (Supabase Phone Auth, OTP delivered over WhatsApp by WATI).
--     Their profile is created only AFTER the OTP is verified (complete_registration), never at send time.
--   * The player's region is snapshotted onto every game session and game, so history keeps its original
--     attribution even if a profile is ever changed.
--   * "verified" (was email_verified) now means: a verified phone OR a verified Google identity (legacy).
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------------------------------------------
-- Regions (exactly four)
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.regions (
  name       text primary key,
  sort_order integer not null
);
insert into public.regions (name, sort_order) values
  ('Croma East Region', 1), ('Croma South Region', 2), ('Croma North Region', 3), ('Croma West Region', 4)
on conflict (name) do nothing;
alter table public.regions enable row level security;
revoke all on public.regions from anon, authenticated;
grant select on public.regions to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Profiles / sessions / games: new columns
-- ---------------------------------------------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'email_verified') then
    alter table public.profiles rename column email_verified to verified;
  end if;
end $$;

-- profiles.region used to hold the GPS-derived state name from the location feature. The Croma region gets that
-- name now, so the old data is preserved under geo_region.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'region')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'geo_region') then
    alter table public.profiles rename column region to geo_region;
  end if;
end $$;

alter table public.profiles
  add column if not exists phone         text,
  add column if not exists region        text references public.regions (name),
  add column if not exists registered_at timestamptz,
  add column if not exists updated_at    timestamptz not null default now(),
  add column if not exists auth_provider text;

-- every row that exists today came from Google sign-in
update public.profiles set auth_provider = 'google' where auth_provider is null;
update public.profiles set registered_at = created_at where registered_at is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_format') then
    alter table public.profiles add constraint profiles_phone_format check (phone is null or phone ~ '^\+91[6-9][0-9]{9}$');
  end if;
end $$;
create unique index if not exists profiles_phone_key  on public.profiles (phone) where phone is not null;
create index        if not exists profiles_region_idx on public.profiles (region);

alter table public.game_sessions add column if not exists region text references public.regions (name);
alter table public.games         add column if not exists region text references public.regions (name);
create index if not exists games_region_idx on public.games (region, created_at desc);

create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

-- A signed-in player can read their own phone / region too (column-limited; still no write access of any kind).
grant select (phone, region, registered_at) on public.profiles to authenticated;
grant select (region) on public.games to authenticated;

-- OTP delivery log used to cap WhatsApp sends per number (anti-abuse; the WATI account pays per message)
create table if not exists public.otp_sends (
  id         bigint generated always as identity primary key,
  phone      text not null,
  created_at timestamptz not null default now()
);
create index if not exists otp_sends_phone_idx   on public.otp_sends (phone, created_at desc);
create index if not exists otp_sends_created_idx on public.otp_sends (created_at);
alter table public.otp_sends enable row level security;
revoke all on public.otp_sends from anon, authenticated;
grant select, insert, delete on public.otp_sends to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Auth trigger: phone-only users get NO profile until they have verified the OTP and registered
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.handle_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if new.phone is not null and new.email is null then
    return new;                       -- phone player: profile is created by complete_registration() after OTP verification
  end if;
  insert into public.profiles (id, display_name, email, avatar_url, verified, auth_provider, registered_at)
  values (
    new.id,
    left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Player'), 120),
    new.email,
    coalesce(meta ->> 'avatar_url', meta ->> 'picture'),
    public.is_google_verified(coalesce(new.raw_app_meta_data, '{}'::jsonb), meta, new.email_confirmed_at),
    'google', now()
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_auth_user failed: %', sqlerrm;
  return new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Leaderboard view + standing (global ranking is unchanged: best score, ties → who reached it first)
-- ---------------------------------------------------------------------------------------------------------------
drop view if exists public.leaderboard;
create view public.leaderboard with (security_invoker = true) as
  select row_number() over (order by best_score desc, best_at asc) as rank, p.*
  from public.profiles p
  where best_score > 0 and not disqualified and verified;
revoke all on public.leaderboard from public, anon, authenticated;
grant select on public.leaderboard to service_role;

create or replace function public.player_standing(p_player uuid)
returns table (out_best integer, out_rank bigint, out_total bigint)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select id, row_number() over (order by best_score desc, best_at asc) as rk
    from profiles where best_score > 0 and not disqualified and verified
  )
  select p.best_score, ranked.rk, (select count(*) from ranked)
  from profiles p left join ranked on ranked.id = p.id
  where p.id = p_player;
$$;

create or replace function public.get_leaderboard(p_limit integer default 10)
returns jsonb language sql stable security definer set search_path = public as $$
  with ranked as (
    select id, display_name, best_score, row_number() over (order by best_score desc, best_at asc) as rk
    from profiles where best_score > 0 and not disqualified and verified
  )
  select jsonb_build_object(
    'total', (select count(*) from ranked),
    'top',   (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', short_name(display_name), 'score', best_score) order by rk), '[]'::jsonb)
              from ranked where rk <= greatest(1, least(coalesce(p_limit, 10), 50))),
    'me',    (select jsonb_build_object('rank', rk, 'name', short_name(display_name), 'best', best_score) from ranked where id = auth.uid())
  )
  where auth.uid() is not null
    and exists (select 1 from profiles where id = auth.uid() and verified);
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- touch_profile: called on every load of a signed-in session
--   * existing profile  → refresh last_seen (Google legacy players also re-sync name/avatar from Google)
--   * phone user, none  → { registered: false }  — they still have to complete registration (no profile is invented)
-- ---------------------------------------------------------------------------------------------------------------
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

  select * into prof from public.profiles where id = uid;
  if not found then
    if u.phone is not null and u.email is null then
      return jsonb_build_object('registered', false, 'phone', '+' || u.phone, 'phone_verified', u.phone_confirmed_at is not null);
    end if;
    insert into public.profiles (id, display_name, email, avatar_url, verified, auth_provider, registered_at)
    values (uid,
      left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Player'), 120),
      u.email, coalesce(meta ->> 'avatar_url', meta ->> 'picture'),
      public.is_google_verified(coalesce(u.raw_app_meta_data, '{}'::jsonb), meta, u.email_confirmed_at), 'google', now())
    returning * into prof;
  elsif prof.auth_provider = 'google' or prof.auth_provider is null then
    update public.profiles set
      display_name = left(coalesce(nullif(meta ->> 'full_name', ''), nullif(meta ->> 'name', ''), display_name), 120),
      email = coalesce(u.email, email),
      avatar_url = coalesce(meta ->> 'avatar_url', meta ->> 'picture', avatar_url),
      verified = verified or public.is_google_verified(coalesce(u.raw_app_meta_data, '{}'::jsonb), meta, u.email_confirmed_at),
      last_seen_at = now()
    where id = uid returning * into prof;
  else
    update public.profiles set last_seen_at = now() where id = uid returning * into prof;   -- phone players: never overwrite name / region
  end if;

  select * into st from public.player_standing(uid);
  return jsonb_build_object(
    'registered', true, 'id', prof.id, 'name', prof.display_name, 'avatar_url', prof.avatar_url,
    'region', prof.region, 'phone', prof.phone, 'auth_provider', prof.auth_provider, 'verified', prof.verified,
    'best', coalesce(st.out_best, 0), 'rank', st.out_rank, 'total', coalesce(st.out_total, 0),
    'games_played', prof.games_played);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- complete_registration: the ONLY way a phone player's profile comes into existence.
--   * requires a phone that Supabase has verified by OTP (auth.users.phone_confirmed_at)
--   * the phone number comes from the verified auth record — never from the client
--   * an existing profile is returned untouched: a returning player's name / region are never overwritten
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.complete_registration(p_name text, p_region text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  u auth.users%rowtype;
  n text;
  prof public.profiles%rowtype;
  st record;
  existed boolean := false;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into u from auth.users where id = uid;
  if not found or u.phone is null or u.phone_confirmed_at is null then raise exception 'phone_not_verified'; end if;

  select * into prof from public.profiles where id = uid;
  if found then
    existed := true;
    update public.profiles set last_seen_at = now() where id = uid returning * into prof;
  else
    n := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
    if char_length(n) < 2 or char_length(n) > 60 or n ~ '[<>]' or n ~ '[[:cntrl:]]' or n !~ '[[:alpha:]]' then raise exception 'invalid_name'; end if;
    if p_region is null or not exists (select 1 from public.regions where name = p_region) then raise exception 'invalid_region'; end if;
    insert into public.profiles (id, display_name, phone, region, verified, auth_provider, consent_at, registered_at)
    values (uid, n, '+' || u.phone, p_region, true, 'phone', now(), now())
    on conflict (id) do nothing;
    select * into prof from public.profiles where id = uid;
  end if;

  select * into st from public.player_standing(uid);
  return jsonb_build_object(
    'registered', true, 'existing', existed, 'id', prof.id, 'name', prof.display_name, 'region', prof.region, 'phone', prof.phone,
    'auth_provider', prof.auth_provider, 'verified', prof.verified,
    'best', coalesce(st.out_best, 0), 'rank', st.out_rank, 'total', coalesce(st.out_total, 0), 'games_played', prof.games_played);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Game sessions / results carry the region snapshot
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.start_session(p_player uuid, p_seed bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; reg text;
begin
  perform 1 from profiles where id = p_player;
  if not found then raise exception 'unknown_player'; end if;
  select region into reg from profiles where id = p_player and verified;
  if not found then raise exception 'not_verified'; end if;
  if (select count(*) from game_sessions where player_id = p_player and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'rate_limited';
  end if;
  insert into game_sessions (player_id, seed, region) values (p_player, p_seed, reg) returning id into sid;
  return sid;
end $$;

create or replace function public.record_game(
  p_player uuid, p_session uuid, p_score integer, p_client_score integer,
  p_duration real, p_caught integer, p_flagged boolean, p_flag_reason text,
  p_lat double precision, p_lng double precision, p_accuracy real, p_city text, p_region text, p_country text,
  p_ip_city text, p_ua text)
returns table (out_best integer, out_rank bigint, out_total bigint)
language plpgsql security definer set search_path = public as $$
declare snapshot_region text;
begin
  update game_sessions set used_at = now()
   where id = p_session and player_id = p_player and used_at is null
   returning region into snapshot_region;
  if not found then raise exception 'session_used_or_missing'; end if;

  insert into games (player_id, session_id, score, client_score, duration_s, phones_caught,
                     flagged, flag_reason, lat, lng, city, ip_city, user_agent, region)
  values (p_player, p_session, p_score, p_client_score, p_duration, p_caught,
          p_flagged, p_flag_reason, p_lat, p_lng, p_city, p_ip_city, p_ua, snapshot_region);

  update profiles set
    games_played = games_played + 1,
    total_score  = total_score + p_score,
    last_seen_at = now(),
    best_at      = case when not p_flagged and p_score > best_score then now() else best_at end,
    best_score   = case when not p_flagged then greatest(best_score, p_score) else best_score end,
    lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng),
    location_accuracy_m = case when p_lat is not null then p_accuracy else location_accuracy_m end,
    location_source = case when p_lat is not null then 'gps' else location_source end,
    city = coalesce(p_city, city), geo_region = coalesce(p_region, geo_region), country = coalesce(p_country, country),
    ip_city = coalesce(p_ip_city, ip_city), user_agent = coalesce(p_ua, user_agent)
  where id = p_player;
  -- note: p_region is the browser's GPS state name → geo_region. The Croma region (profiles.region) is never touched here.

  return query select * from player_standing(p_player);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- OTP send cap (called by the send-sms Auth Hook before it spends a WhatsApp message)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.hook_allow_otp(p_phone text, p_max_per_hour integer default 5)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from otp_sends where created_at < now() - interval '2 days';
  select count(*) into n from otp_sends where phone = p_phone and created_at > now() - interval '1 hour';
  if n >= p_max_per_hour then return false; end if;
  insert into otp_sends (phone) values (p_phone);
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- Region-wise reporting (admin / service role only)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.admin_region_report()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by (r ->> 'sort')::int), '[]'::jsonb) from (
    select jsonb_build_object(
      'sort', rg.sort_order, 'region', rg.name,
      'players',     (select count(*) from profiles p where p.region = rg.name),
      'games',       (select count(*) from games g where g.region = rg.name),
      'valid_games', (select count(*) from games g where g.region = rg.name and not g.flagged),
      'avg_score',   (select coalesce(round(avg(g.score)), 0) from games g where g.region = rg.name and not g.flagged),
      'top_score',   (select coalesce(max(g.score), 0) from games g where g.region = rg.name and not g.flagged),
      'best_player_score', (select coalesce(max(p.best_score), 0) from profiles p where p.region = rg.name and not p.disqualified)) as r
    from regions rg
    union all
    select jsonb_build_object(
      'sort', 99, 'region', 'Legacy / unknown',
      'players',     (select count(*) from profiles p where p.region is null),
      'games',       (select count(*) from games g where g.region is null),
      'valid_games', (select count(*) from games g where g.region is null and not g.flagged),
      'avg_score',   (select coalesce(round(avg(g.score)), 0) from games g where g.region is null and not g.flagged),
      'top_score',   (select coalesce(max(g.score), 0) from games g where g.region is null and not g.flagged),
      'best_player_score', (select coalesce(max(p.best_score), 0) from profiles p where p.region is null and not p.disqualified))
  ) x;
$$;

create or replace function public.admin_stats(p_tz text default 'Asia/Kolkata')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'players',        (select count(*) from profiles),
    'verified',       (select count(*) from profiles where verified),
    'players_today',  (select count(*) from profiles where (created_at at time zone p_tz)::date = (now() at time zone p_tz)::date),
    'games',          (select count(*) from games),
    'games_today',    (select count(*) from games where (created_at at time zone p_tz)::date = (now() at time zone p_tz)::date),
    'top_score',      (select coalesce(max(best_score), 0) from profiles where not disqualified and verified),
    'avg_score',      (select coalesce(round(avg(score)), 0) from games where not flagged),
    'flagged_games',  (select count(*) from games where flagged),
    'located_gps',    (select count(*) from profiles where location_source = 'gps'),
    'emails_sent',    (select count(*) from email_log where status = 'sent'),
    'emails_failed',  (select count(*) from email_log where status = 'failed'),
    'thanks_sent',    (select count(*) from profiles where thanks_sent_at is not null),
    'phone_players',  (select count(*) from profiles where auth_provider = 'phone'),
    'legacy_players', (select count(*) from profiles where auth_provider is distinct from 'phone'),
    'by_region',      public.admin_region_report(),
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

-- Admin lists, now filterable by region. p_region: null/'all' = everyone, 'legacy' = no region, otherwise an exact region.
-- (Players / leaderboard use the player's region; the Games list uses the region SNAPSHOT stored on each game.)
drop function if exists public.admin_list(text, text, text, boolean, uuid, integer, integer);
create or replace function public.admin_list(
  p_kind text, p_q text default '', p_verified text default 'all', p_flagged boolean default false,
  p_player uuid default null, p_limit integer default 50, p_offset integer default 0, p_region text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  pat text := case when btrim(coalesce(p_q, '')) = '' then null
                   else '%' || replace(replace(replace(left(btrim(p_q), 80), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  lim integer := case when p_limit is null then null else greatest(1, least(p_limit, 500)) end;
  off integer := greatest(0, coalesce(p_offset, 0));
  reg text := nullif(nullif(p_region, ''), 'all');
  out jsonb;
begin
  if reg is not null and reg <> 'legacy' and not exists (select 1 from regions where name = reg) then raise exception 'unknown_region'; end if;

  if p_kind = 'leaderboard' then
    with ranked as (
      select row_number() over (order by p.best_score desc, p.best_at asc nulls last) as rank, p.*
      from profiles p
      where p.best_score > 0 and not p.disqualified
        and (p_verified = 'all' or (p_verified = 'yes' and p.verified) or (p_verified = 'no' and not p.verified))
        and (reg is null or (reg = 'legacy' and p.region is null) or p.region = reg)
    ), filt as (
      select r.*, l.rank as official_rank from ranked r left join leaderboard l on l.id = r.id
      where pat is null or r.display_name ilike pat or r.email ilike pat or r.phone ilike pat or coalesce(r.city, r.ip_city, '') ilike pat
    )
    select jsonb_build_object(
      'total', (select count(*) from filt),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'notes' - 'user_agent') from (select * from filt order by rank limit lim offset off) x), '[]'::jsonb)) into out;
  elsif p_kind = 'players' then
    with filt as (
      select l.rank, p.* from profiles p left join leaderboard l on l.id = p.id
      where (p_verified = 'all' or (p_verified = 'yes' and p.verified) or (p_verified = 'no' and not p.verified))
        and (reg is null or (reg = 'legacy' and p.region is null) or p.region = reg)
        and (pat is null or p.display_name ilike pat or p.email ilike pat or p.phone ilike pat or coalesce(p.city, p.ip_city, '') ilike pat)
    )
    select jsonb_build_object(
      'total', (select count(*) from filt),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'notes' - 'user_agent') from (select * from filt order by created_at desc limit lim offset off) x), '[]'::jsonb)) into out;
  elsif p_kind = 'games' then
    with filt as (
      select g.id, g.created_at, g.score, g.client_score, g.duration_s, g.phones_caught, g.flagged, g.flag_reason, g.region,
             g.city, g.ip_city, g.lat, g.lng, g.player_id, p.display_name, p.email, p.phone, p.verified
      from games g join profiles p on p.id = g.player_id
      where (p_verified = 'all' or (p_verified = 'yes' and p.verified) or (p_verified = 'no' and not p.verified))
        and (reg is null or (reg = 'legacy' and g.region is null) or g.region = reg)
        and (pat is null or p.display_name ilike pat or p.email ilike pat or p.phone ilike pat or coalesce(p.city, p.ip_city, '') ilike pat)
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
-- Grants (nothing executable by default)
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.set_updated_at()                              from public, anon, authenticated;
revoke all on function public.handle_auth_user()                            from public, anon, authenticated;
revoke all on function public.touch_profile()                               from public, anon, authenticated;
revoke all on function public.complete_registration(text, text)             from public, anon, authenticated;
revoke all on function public.get_leaderboard(integer)                      from public, anon, authenticated;
revoke all on function public.player_standing(uuid)                         from public, anon, authenticated;
revoke all on function public.start_session(uuid, bigint)                   from public, anon, authenticated;
revoke all on function public.record_game(uuid, uuid, integer, integer, real, integer, boolean, text, double precision, double precision, real, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.hook_allow_otp(text, integer)                 from public, anon, authenticated;
revoke all on function public.admin_region_report()                         from public, anon, authenticated;
revoke all on function public.admin_stats(text)                             from public, anon, authenticated;
revoke all on function public.admin_list(text, text, text, boolean, uuid, integer, integer, text) from public, anon, authenticated;

grant execute on function public.touch_profile()                    to authenticated;
grant execute on function public.complete_registration(text, text) to authenticated;
grant execute on function public.get_leaderboard(integer)          to authenticated;
grant execute on function public.player_standing(uuid)             to service_role;
grant execute on function public.start_session(uuid, bigint)       to service_role;
grant execute on function public.record_game(uuid, uuid, integer, integer, real, integer, boolean, text, double precision, double precision, real, text, text, text, text, text) to service_role;
grant execute on function public.hook_allow_otp(text, integer)     to service_role;
grant execute on function public.admin_region_report()             to service_role;
grant execute on function public.admin_stats(text)                 to service_role;
grant execute on function public.admin_list(text, text, text, boolean, uuid, integer, integer, text) to service_role;
