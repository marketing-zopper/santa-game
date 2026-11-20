-- Google-only players.
--
-- Supabase Auth can also allow email/password sign-ups. The game's journey is Google or Guest, so "verified" is
-- tightened to mean: signed in through GOOGLE with a verified email. Accounts created any other way:
--   * never get email_verified = true  → can't start games, aren't ranked, can't use the admin dashboard
-- (Disabling the Email provider in Authentication → Providers is still recommended; this makes it safe either way.)
--
-- Safe to run more than once.

create or replace function public.is_google_verified(app jsonb, meta jsonb, confirmed timestamptz)
returns boolean language sql immutable set search_path = public as $$
  select (coalesce(app ->> 'provider', '') = 'google' or coalesce(app -> 'providers', '[]'::jsonb) ? 'google')
     and coalesce((meta ->> 'email_verified')::boolean, confirmed is not null, false);
$$;

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
    public.is_google_verified(coalesce(new.raw_app_meta_data, '{}'::jsonb), meta, new.email_confirmed_at)
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  raise warning 'handle_auth_user failed: %', sqlerrm;
  return new;
end $$;

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
    public.is_google_verified(coalesce(u.raw_app_meta_data, '{}'::jsonb), meta, u.email_confirmed_at))
  on conflict (id) do update set
    display_name = excluded.display_name,
    email = excluded.email,
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    email_verified = excluded.email_verified,
    last_seen_at = now()
  returning * into prof;

  select * into st from public.player_standing(uid);
  return jsonb_build_object(
    'id', prof.id, 'name', prof.display_name, 'avatar_url', prof.avatar_url,
    'verified', prof.email_verified,
    'best', coalesce(st.out_best, 0), 'rank', st.out_rank, 'total', coalesce(st.out_total, 0),
    'games_played', prof.games_played);
end $$;

-- Only verified (Google) players can begin an authorised game.
create or replace function public.start_session(p_player uuid, p_seed bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  perform 1 from profiles where id = p_player;
  if not found then raise exception 'unknown_player'; end if;
  perform 1 from profiles where id = p_player and email_verified;
  if not found then raise exception 'not_verified'; end if;
  if (select count(*) from game_sessions where player_id = p_player and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'rate_limited';
  end if;
  insert into game_sessions (player_id, seed) values (p_player, p_seed) returning id into sid;
  return sid;
end $$;

-- The leaderboard RPC is for verified players only as well.
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
  where auth.uid() is not null
    and exists (select 1 from profiles where id = auth.uid() and email_verified);
$$;

revoke all on function public.is_google_verified(jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.is_google_verified(jsonb, jsonb, timestamptz) to service_role;
revoke all on function public.handle_auth_user()                        from public, anon, authenticated;
revoke all on function public.touch_profile()                           from public, anon, authenticated;
revoke all on function public.start_session(uuid, bigint)               from public, anon, authenticated;
revoke all on function public.get_leaderboard(integer)                  from public, anon, authenticated;
grant execute on function public.touch_profile()                        to authenticated;
grant execute on function public.get_leaderboard(integer)               to authenticated;
grant execute on function public.start_session(uuid, bigint)            to service_role;
