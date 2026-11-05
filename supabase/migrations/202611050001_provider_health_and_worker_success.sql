-- Persist only the latest authenticated operator health observation per provider.
-- No credentials, user prompts, provider response bodies, contacts, or lead data are stored.
create table if not exists public.pa_provider_health (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('database','discovery','worker','ai','email','whatsapp')),
  status text not null check (status in ('reachable','paused','blocked','not_configured','not_applicable','unreachable','rate_limited')),
  checked_at timestamptz not null default now(),
  last_success_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  last_error text,
  recommended_action text not null default '',
  primary key (user_id, provider)
);
alter table public.pa_provider_health enable row level security;
revoke all on public.pa_provider_health from anon;
grant select, insert, update on public.pa_provider_health to authenticated;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pa_provider_health'
      and policyname = 'own_provider_health'
  ) then
    create policy own_provider_health on public.pa_provider_health for all to authenticated
      using (user_id = (select auth.uid()))
      with check (user_id = (select auth.uid()));
  end if;
end $$;

-- `last_finished_at` is activity, not necessarily success. Track the latter
-- separately so a rejected provider request can never be shown as success.
alter table public.pa_cloud_worker
  add column if not exists last_successful_at timestamptz;

create or replace function public.pa_record_discovery_success()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.pa_cloud_worker
      set last_successful_at = now()
      where singleton;
  end if;
  return new;
end;
$$;
revoke all on function public.pa_record_discovery_success() from public, anon, authenticated;

drop trigger if exists pa_record_discovery_success on public.pa_discovery_jobs;
create trigger pa_record_discovery_success
  after update of status on public.pa_discovery_jobs
  for each row execute function public.pa_record_discovery_success();

create or replace function public.pa_cloud_worker_status() returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object(
   'enabled', enabled,
   'mode', 'listing-only',
   'daily_limit', daily_limit,
   'daily_attempts', case
     when budget_date = (now() at time zone 'UTC')::date then daily_attempts
     else 0
   end,
   'daily_remaining', greatest(
     daily_limit - case
       when budget_date = (now() at time zone 'UTC')::date then daily_attempts
       else 0
     end,
     0
   ),
   'last_started_at', last_started_at,
   'last_finished_at', last_finished_at,
   'last_successful_at', last_successful_at,
   'last_error', nullif(left(last_error, 500), ''),
   'interval_minutes', 5
 )
 from public.pa_cloud_worker
 where singleton;
$$;
revoke all on function public.pa_cloud_worker_status() from public, anon;
grant execute on function public.pa_cloud_worker_status() to authenticated, service_role;
