-- Delivery log for the WhatsApp OTP hook, so "the code arrived but the app showed an error" (or the opposite) can be
-- diagnosed from data instead of guesswork. Stores a MASKED phone number, the outcome, timings and WATI's HTTP status.
-- It never stores the OTP or any token. Service role only; entries older than 30 days are pruned.
--
--   select created_at, phone_masked, outcome, http_status, wati_ms, hook_ms, code, detail
--   from public.otp_hook_log order by created_at desc limit 50;
--
-- Safe to run more than once.

create table if not exists public.otp_hook_log (
  id           bigint generated always as identity primary key,
  phone_masked text not null,
  outcome      text not null check (outcome in ('sent', 'sent_slow', 'failed', 'failed_slow')),
  http_status  integer,
  wati_ms      integer,
  hook_ms      integer,
  code         text,
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists otp_hook_log_created_idx on public.otp_hook_log (created_at desc);
alter table public.otp_hook_log enable row level security;
revoke all on public.otp_hook_log from anon, authenticated;
grant select, insert, delete on public.otp_hook_log to service_role;

create or replace function public.hook_allow_otp(p_phone text, p_max_per_hour integer default 5)
returns boolean language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from otp_sends where created_at < now() - interval '2 days';
  delete from otp_hook_log where created_at < now() - interval '30 days';
  select count(*) into n from otp_sends where phone = p_phone and created_at > now() - interval '1 hour';
  if n >= p_max_per_hour then return false; end if;
  insert into otp_sends (phone) values (p_phone);
  return true;
end $$;
revoke all on function public.hook_allow_otp(text, integer) from public, anon, authenticated;
grant execute on function public.hook_allow_otp(text, integer) to service_role;
