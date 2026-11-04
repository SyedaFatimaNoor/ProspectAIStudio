-- Operator-visible worker metadata. This changes no schedules, limits, jobs, or
-- source configuration. Errors are bounded and exposed only through the
-- existing authenticated status RPC; no token, job owner, or secret is returned.
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
   'last_error', nullif(left(last_error, 500), ''),
   'interval_minutes', 5
 )
 from public.pa_cloud_worker
 where singleton;
$$;
revoke all on function public.pa_cloud_worker_status() from public, anon;
grant execute on function public.pa_cloud_worker_status() to authenticated, service_role;
