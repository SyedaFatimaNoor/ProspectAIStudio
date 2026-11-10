-- Repository-side Discovery worker hardening. This migration is not applied to
-- production by the coding agent. It contains no credentials, tokens, user rows,
-- provider payloads, or business facts.

-- A bounded stage name is safe operational telemetry. It never contains endpoint
-- URLs, tokens, request bodies, user identifiers, or raw provider content.
alter table public.pa_cloud_worker
  add column if not exists last_failed_stage text;

alter table public.pa_discovery_jobs
  add column if not exists worker_stage text;

alter table public.pa_cloud_worker
  drop constraint if exists pa_cloud_worker_last_failed_stage_check;
alter table public.pa_cloud_worker
  add constraint pa_cloud_worker_last_failed_stage_check
  check (last_failed_stage is null or last_failed_stage in (
    'authentication', 'configuration', 'database', 'heartbeat',
    'snapshot_status', 'source_pause', 'claim', 'job_validation',
    'snapshot_search', 'overpass_search', 'transform', 'commit',
    'failure_logging', 'completed'
  ));

alter table public.pa_discovery_jobs
  drop constraint if exists pa_discovery_jobs_worker_stage_check;
alter table public.pa_discovery_jobs
  add constraint pa_discovery_jobs_worker_stage_check
  check (worker_stage is null or worker_stage in (
    'authentication', 'configuration', 'database', 'heartbeat',
    'snapshot_status', 'source_pause', 'claim', 'job_validation',
    'snapshot_search', 'overpass_search', 'transform', 'commit',
    'failure_logging', 'completed'
  ));

-- Keep all database work inside the worker's 80-second overall deadline.
-- These per-function settings bound slow plans, lock waits and PostgREST calls.
alter function public.pa_cloud_heartbeat(text,text)
  set statement_timeout = '10000ms',
  set lock_timeout = '3000ms';
alter function public.pa_cloud_claim(text,text)
  set statement_timeout = '15000ms',
  set lock_timeout = '3000ms';
alter function public.pa_osm_snapshot_status()
  set statement_timeout = '10000ms',
  set lock_timeout = '3000ms';
alter function public.pa_osm_search(text,text,text,int)
  set statement_timeout = '15000ms',
  set lock_timeout = '3000ms';
alter function public.pa_cloud_commit(uuid,uuid,jsonb,integer)
  set statement_timeout = '25000ms',
  set lock_timeout = '3000ms';
alter function public.pa_cloud_fail(uuid,uuid,text,text,integer,text)
  set statement_timeout = '10000ms',
  set lock_timeout = '3000ms';

-- Preserve the prior six-argument RPC for a rolling deploy while adding a
-- bounded stage field. The seven-argument form is the repository source of truth.
drop function if exists public.pa_cloud_fail(uuid,uuid,text,text,integer,text,text);
create function public.pa_cloud_fail(
  p_job uuid,
  p_token uuid,
  p_error text,
  p_error_category text default 'internal',
  p_response_time_ms integer default null,
  p_worker_version text default null,
  p_stage text default null
) returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '10000ms'
set lock_timeout = '3000ms'
as $$
declare
  w public.pa_cloud_worker;
  j public.pa_discovery_jobs;
  category text;
  next_status text;
  retry_seconds integer;
  reason text;
  stage text;
begin
  category := case
    when coalesce(p_error, '') ~ 'HTTP (400|401|403|404|405|406|410|422)' then 'provider_blocked'
    when coalesce(p_error, '') ~ 'HTTP 429' then 'rate_limited'
    when coalesce(p_error, '') ~ 'HTTP (408|425|500|502|503|504)' then 'transient_provider'
    when p_error_category in ('provider_blocked','rate_limited','timeout','network_error','transient_provider','invalid_job','invalid_response','cancelled','internal') then p_error_category
    else 'internal'
  end;
  if p_response_time_ms is not null and (p_response_time_ms < 0 or p_response_time_ms > 80000) then
    p_response_time_ms := null;
  end if;
  stage := case
    when p_stage in (
      'authentication','configuration','database','heartbeat','snapshot_status',
      'source_pause','claim','job_validation','snapshot_search','overpass_search',
      'transform','commit','failure_logging','completed'
    ) then p_stage
    else null
  end;

  select * into w from public.pa_cloud_worker where singleton for update;
  if p_token is null or w.token is null or w.token is distinct from p_token then return; end if;
  select * into j from public.pa_discovery_jobs where id = p_job for update;
  if j.id is null or j.status <> 'running' then
    update public.pa_cloud_worker
       set token = null, lease_until = null, last_finished_at = now(),
           last_heartbeat_at = now(), lifecycle_state = case
             when not enabled and lifecycle_state = 'blocked' then 'blocked'
             when not enabled then 'paused'
             else 'reachable'
           end,
           last_failed_stage = coalesce(stage, last_failed_stage)
     where singleton;
    return;
  end if;

  reason := left(coalesce(nullif(btrim(p_error), ''), 'Discovery worker failed.'), 500);
  if category = 'provider_blocked' then
    next_status := 'blocked';
    retry_seconds := 0;
  elsif category = 'rate_limited' and j.attempts < 3 then
    next_status := 'rate_limited';
    retry_seconds := 300 * power(2, greatest(0, least(j.attempts - 1, 2)))::integer;
  elsif category in ('timeout','network_error','transient_provider') and j.attempts < 3 then
    next_status := 'queued';
    retry_seconds := 60 * power(2, greatest(0, least(j.attempts - 1, 2)))::integer;
  else
    next_status := 'failed';
    retry_seconds := 0;
  end if;

  update public.pa_discovery_jobs
     set status = next_status,
         error = reason,
         error_category = category,
         worker_stage = coalesce(stage, worker_stage),
         response_time_ms = coalesce(p_response_time_ms, response_time_ms),
         completed_at = case when next_status in ('blocked','failed') then now() else null end,
         lease_until = null,
         next_retry_at = case when retry_seconds > 0 then now() + make_interval(secs => retry_seconds) else next_retry_at end,
         worker_version = coalesce(nullif(p_worker_version,''), worker_version),
         logs = logs || jsonb_build_array(now()::text || ' Cloud attempt failed (' || category || ') at ' || coalesce(stage,'unknown') || ': ' || reason)
   where id = j.id;

  update public.pa_cloud_worker
     set token = null,
         lease_until = null,
         last_finished_at = now(),
         last_heartbeat_at = now(),
         last_error = reason,
         last_error_category = category,
         last_failed_stage = coalesce(stage, last_failed_stage),
         last_failed_job_at = case
           when next_status in ('blocked','failed') then now()
           else last_failed_job_at
         end,
         last_provider_error = case
           when category in ('provider_blocked','rate_limited','timeout','network_error','transient_provider','invalid_response') then reason
           else last_provider_error
         end,
         worker_version = coalesce(nullif(p_worker_version,''), worker_version),
         next_allowed_at = case when category = 'rate_limited' and retry_seconds > 0 then now() + make_interval(secs => retry_seconds) else next_allowed_at end,
         enabled = case when category = 'provider_blocked' then false else enabled end,
         lifecycle_state = case
           when category = 'provider_blocked' then 'blocked'
           when category = 'rate_limited' and retry_seconds > 0 then 'rate_limited'
           when next_status = 'failed' then 'failed'
           else 'queued'
         end
   where singleton;
end;
$$;

create or replace function public.pa_cloud_fail(
  p_job uuid,
  p_token uuid,
  p_error text,
  p_error_category text,
  p_response_time_ms integer,
  p_worker_version text
) returns void
language sql
security definer
set search_path = public
set statement_timeout = '10000ms'
set lock_timeout = '3000ms'
as $$
  select public.pa_cloud_fail(
    p_job, p_token, p_error, p_error_category,
    p_response_time_ms, p_worker_version, null
  );
$$;

revoke all on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
revoke all on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text,text) to service_role;
grant execute on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text) to service_role;

-- Expose only the bounded stage name through the existing worker status RPC.
create or replace function public.pa_cloud_worker_status() returns jsonb
language sql stable security definer set search_path = public as $$
 select jsonb_build_object(
   'enabled', w.enabled,
   'mode', 'listing-only',
   'lifecycle_state', w.lifecycle_state,
   'paused', not w.enabled,
   'running', w.lifecycle_state = 'running' and w.lease_until > now(),
   'daily_limit', w.daily_limit,
   'daily_attempts', case when w.budget_date = (now() at time zone 'UTC')::date then w.daily_attempts else 0 end,
   'daily_remaining', greatest(w.daily_limit - case when w.budget_date = (now() at time zone 'UTC')::date then w.daily_attempts else 0 end, 0),
   'provider_source', w.provider_source,
   'worker_version', w.worker_version,
   'last_failed_stage', w.last_failed_stage,
   'last_heartbeat_at', w.last_heartbeat_at,
   'last_started_at', w.last_started_at,
   'last_finished_at', w.last_finished_at,
   'last_successful_at', w.last_successful_at,
   'last_successful_job_at', w.last_successful_job_at,
   'last_failed_job_at', w.last_failed_job_at,
   'last_provider_error', nullif(left(w.last_provider_error, 500), ''),
   'last_error_category', w.last_error_category,
   'last_error', nullif(left(w.last_error, 500), ''),
   'last_successful_job', (
     select jsonb_strip_nulls(jsonb_build_object(
       'completed_at', j.completed_at, 'provider', j.provider,
       'source', j.provider_source, 'result_count', j.result_count,
       'duplicate_count', j.duplicate_count, 'response_time_ms', j.response_time_ms
     )) from public.pa_discovery_jobs j
     where j.status = 'completed' and j.completed_at is not null
     order by j.completed_at desc limit 1
   ),
   'last_failed_job', (
     select jsonb_strip_nulls(jsonb_build_object(
       'completed_at', j.completed_at, 'provider', j.provider,
       'source', j.provider_source, 'error_category', j.error_category,
       'worker_stage', j.worker_stage,
       'response_time_ms', j.response_time_ms, 'status', j.status
     )) from public.pa_discovery_jobs j
     where j.status in ('failed','blocked') and j.completed_at is not null
     order by j.completed_at desc limit 1
   ),
   'interval_minutes', 5
 ) from public.pa_cloud_worker w where w.singleton;
$$;
