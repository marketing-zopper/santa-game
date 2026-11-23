-- Google sign-in exists ONLY for the /admin dashboard. Players are phone (WhatsApp OTP) accounts, full stop.
--
--   * Google accounts no longer get a player profile (the auth trigger is removed), so signing in to /admin can never
--     create or touch a player record.
--   * Only phone-verified players can start games or read the leaderboard (start_session / get_leaderboard).
--   * The admin allow-list is exactly one person.
--   * HISTORY IS KEPT: existing Google players, their scores and games stay in the database and on the leaderboard
--     (auth_provider = 'google', region NULL). They simply cannot play on new Google sessions; they would register
--     with a phone number like anyone else (accounts are never merged automatically).
--
-- Safe to run more than once.

drop trigger  if exists on_auth_user_created on auth.users;
drop function if exists public.handle_auth_user();

-- touch_profile: phone players only. Anyone else (e.g. the admin's Google session) gets { registered: false } and nothing is created.
create or replace function public.touch_profile()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  u auth.users%rowtype;
  st record;
  prof public.profiles%rowtype;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  select * into u from auth.users where id = uid;
  if not found then raise exception 'not_authenticated' using errcode = '28000'; end if;

  if u.phone is null then
    return jsonb_build_object('registered', false, 'player', false, 'phone', null, 'phone_verified', false);
  end if;

  select * into prof from public.profiles where id = uid;
  if not found then
    return jsonb_build_object('registered', false, 'phone', '+' || u.phone, 'phone_verified', u.phone_confirmed_at is not null);
  end if;
  update public.profiles set last_seen_at = now() where id = uid returning * into prof;   -- never overwrites name / region

  select * into st from public.player_standing(uid);
  return jsonb_build_object(
    'registered', true, 'id', prof.id, 'name', prof.display_name, 'avatar_url', prof.avatar_url,
    'region', prof.region, 'phone', prof.phone, 'auth_provider', prof.auth_provider, 'verified', prof.verified,
    'best', coalesce(st.out_best, 0), 'rank', st.out_rank, 'total', coalesce(st.out_total, 0),
    'games_played', prof.games_played);
end $$;

-- Only registered PHONE players can start an authorised game.
create or replace function public.start_session(p_player uuid, p_seed bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid; reg text;
begin
  perform 1 from profiles where id = p_player;
  if not found then raise exception 'unknown_player'; end if;
  select region into reg from profiles where id = p_player and verified and auth_provider = 'phone';
  if not found then raise exception 'not_verified'; end if;
  if (select count(*) from game_sessions where player_id = p_player and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'rate_limited';
  end if;
  insert into game_sessions (player_id, seed, region) values (p_player, p_seed, reg) returning id into sid;
  return sid;
end $$;

-- The in-game leaderboard is for registered phone players only (legacy rows still appear ON the board).
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
    and exists (select 1 from profiles where id = auth.uid() and verified and auth_provider = 'phone');
$$;

revoke all on function public.touch_profile()                 from public, anon, authenticated;
revoke all on function public.start_session(uuid, bigint)     from public, anon, authenticated;
revoke all on function public.get_leaderboard(integer)        from public, anon, authenticated;
grant execute on function public.touch_profile()              to authenticated;
grant execute on function public.get_leaderboard(integer)     to authenticated;
grant execute on function public.start_session(uuid, bigint)  to service_role;

-- The one and only admin (verified Google account on /admin)
delete from public.admin_users where email <> 'marketingext@zopper.com';
insert into public.admin_users (email) values ('marketingext@zopper.com') on conflict (email) do nothing;
