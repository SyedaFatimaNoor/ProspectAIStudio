-- Reliable, auditable lifecycle for the bounded cloud discovery worker. This
-- migration does not enable scheduling, dispatch a job, contact a provider, or
-- create any lead.

alter table public.pa_discovery_jobs
  drop constraint if exists pa_discovery_jobs_status_check;
alter table public.pa_discovery_jobs
  add constraint pa_discovery_jobs_status_check
  check (status in ('queued','running','paused','cancelled','completed','failed','blocked','rate_limited'));
alter table public.pa_discovery_jobs
  add column if not exists provider_source text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists response_time_ms integer check (response_time_ms is null or response_time_ms between 0 and 80000),
  add column if not exists result_count integer check (result_count is null or result_count >= 0),
  add column if not exists duplicate_count integer check (duplicate_count is null or duplicate_count >= 0),
  add column if not exists error_category text,
  add column if not exists worker_version text;
create index if not exists pa_discovery_jobs_lifecycle_idx
  on public.pa_discovery_jobs(status, next_retry_at, created_at);

alter table public.pa_cloud_worker
  add column if not exists lifecycle_state text not null default 'configured'
    check (lifecycle_state in ('configured','reachable','queued','running','completed','failed','blocked','paused','rate_limited')),
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists worker_version text,
  add column if not exists provider_source text,
  add column if not exists last_successful_job_at timestamptz,
  add column if not exists last_failed_job_at timestamptz,
  add column if not exists last_provider_error text,
  add column if not exists last_error_category text;

-- Preserve the earlier 406 safety pause as a blocked source rather than making
-- it look like an ordinary operator pause.
update public.pa_cloud_worker
   set lifecycle_state = case
     when enabled then 'configured'
     when coalesce(last_error, '') ~ 'HTTP (400|401|403|404|405|406|410|422)' then 'blocked'
     else 'paused'
   end,
       last_provider_error = case
         when coalesce(last_error, '') ~ 'HTTP (400|401|403|404|405|406|410|422)' then left(last_error, 500)
         else last_provider_error
       end,
       last_error_category = case
         when coalesce(last_error, '') ~ 'HTTP (400|401|403|404|405|406|410|422)' then 'provider_blocked'
         else last_error_category
       end
 where singleton;

create or replace function public.pa_cloud_heartbeat(
  p_source text,
  p_worker_version text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(length(p_source), 0) = 0 or length(p_source) > 200
     or p_source !~ '^openstreetmap:[a-z0-9.-]+$' then
    raise exception 'Invalid worker source marker';
  end if;
  if coalesce(length(p_worker_version), 0) = 0 or length(p_worker_version) > 80
     or p_worker_version !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Invalid worker version';
  end if;

  update public.pa_cloud_worker
     set last_heartbeat_at = now(),
         provider_source = p_source,
         worker_version = p_worker_version,
         lifecycle_state = case
           when not enabled and lifecycle_state = 'blocked' then 'blocked'
           when not enabled then 'paused'
           when lifecycle_state = 'running' and lease_until > now() then 'running'
           when lifecycle_state = 'rate_limited' and next_allowed_at > now() then 'rate_limited'
           else 'reachable'
         end
   where singleton;
end;
$$;
revoke all on function public.pa_cloud_heartbeat(text,text) from public, anon, authenticated;
grant execute on function public.pa_cloud_heartbeat(text,text) to service_role;

-- Claiming remains database-selected and leased. No request-supplied tenant or
-- job ID can affect the selection.
drop function if exists public.pa_cloud_claim();
create function public.pa_cloud_claim(
  p_source text default 'openstreetmap:unknown',
  p_worker_version text default 'unknown'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.pa_cloud_worker;
  j public.pa_discovery_jobs;
  t uuid;
  has_queued boolean;
begin
  if coalesce(length(p_source), 0) = 0 or length(p_source) > 200
     or p_source !~ '^openstreetmap:[a-z0-9.-]+$' then
    raise exception 'Invalid worker source marker';
  end if;
  if coalesce(length(p_worker_version), 0) = 0 or length(p_worker_version) > 80
     or p_worker_version !~ '^[A-Za-z0-9._-]+$' then
    raise exception 'Invalid worker version';
  end if;

  select * into w from public.pa_cloud_worker where singleton for update;
  if not w.enabled then
    update public.pa_cloud_worker
       set lifecycle_state = case when lifecycle_state = 'blocked' then 'blocked' else 'paused' end,
           last_heartbeat_at = now(), provider_source = p_source, worker_version = p_worker_version
     where singleton;
    return null;
  end if;
  if w.lease_until > now() then
    update public.pa_cloud_worker
       set lifecycle_state = 'running', last_heartbeat_at = now(),
           provider_source = p_source, worker_version = p_worker_version
     where singleton;
    return null;
  end if;
  if w.next_allowed_at > now() then
    update public.pa_cloud_worker
       set lifecycle_state = case when last_error_category = 'rate_limited' then 'rate_limited' else 'queued' end,
           last_heartbeat_at = now(), provider_source = p_source, worker_version = p_worker_version
     where singleton;
    return null;
  end if;
  if w.budget_date <> (now() at time zone 'UTC')::date then
    w.daily_attempts := 0;
  end if;
  if w.daily_attempts >= w.daily_limit then
    update public.pa_cloud_worker
       set lifecycle_state = 'queued', last_heartbeat_at = now(),
           provider_source = p_source, worker_version = p_worker_version
     where singleton;
    return null;
  end if;

  update public.pa_discovery_jobs
     set status = 'failed', lease_until = null, completed_at = now(),
         error = 'Worker lease expired after the maximum number of safe attempts. Review logs before resuming.',
         error_category = 'recovery_exhausted',
         logs = logs || jsonb_build_array(now()::text || ' Cloud worker recovery: retry limit reached.')
   where status = 'running' and lease_until < now() and attempts >= 3;

  select * into j
    from public.pa_discovery_jobs
   where (
     (status in ('queued','rate_limited') and next_retry_at <= now())
     or (status = 'running' and lease_until < now())
   )
     and attempts < 3
   order by created_at
   for update skip locked
   limit 1;

  if j.id is null then
    select exists(
      select 1 from public.pa_discovery_jobs
       where status in ('queued','rate_limited') and attempts < 3
    ) into has_queued;
    update public.pa_cloud_worker
       set lifecycle_state = case when has_queued then 'queued' else 'reachable' end,
           last_heartbeat_at = now(), provider_source = p_source, worker_version = p_worker_version
     where singleton;
    return null;
  end if;

  t := gen_random_uuid();
  update public.pa_cloud_worker
     set token = t,
         lease_until = now() + interval '2 minutes',
         next_allowed_at = now() + interval '5 minutes',
         daily_attempts = w.daily_attempts + 1,
         budget_date = (now() at time zone 'UTC')::date,
         last_started_at = now(),
         last_heartbeat_at = now(),
         last_error = null,
         last_error_category = null,
         provider_source = p_source,
         worker_version = p_worker_version,
         lifecycle_state = 'running'
   where singleton;

  update public.pa_discovery_jobs
     set status = 'running',
         attempts = attempts + 1,
         lease_until = now() + interval '2 minutes',
         started_at = now(),
         completed_at = null,
         processed = 0,
         total = 0,
         result_count = null,
         duplicate_count = null,
         response_time_ms = null,
         error = null,
         error_category = null,
         provider_source = p_source,
         worker_version = p_worker_version,
         logs = logs || jsonb_build_array(
           now()::text || case when j.status = 'running'
             then ' Cloud worker recovered an expired lease. Querying OpenStreetMap; listing-only review.'
             else ' Cloud worker claimed job. Querying OpenStreetMap; listing-only review, not live website verification.'
           end
         )
   where id = j.id
   returning * into j;

  return jsonb_build_object('token', t, 'job', to_jsonb(j));
end;
$$;
revoke all on function public.pa_cloud_claim(text,text) from public, anon, authenticated;
grant execute on function public.pa_cloud_claim(text,text) to service_role;

-- Results are committed atomically after source validation and a live lease
-- recheck. A lost acknowledgement cannot create duplicate businesses.
drop function if exists public.pa_cloud_commit(uuid,uuid,jsonb);
create function public.pa_cloud_commit(
  p_job uuid,
  p_token uuid,
  p_rows jsonb,
  p_response_time_ms integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.pa_cloud_worker;
  j public.pa_discovery_jobs;
  r jsonb;
  b uuid;
  run_id uuid;
  n integer := 0;
  added integer := 0;
  stamp text := now()::text;
  review_note text := 'Listing-only cloud review. No business website was fetched, no independent domain search was performed, and current operation, official ownership and website absence remain unverified. Manual review required.';
begin
  if p_response_time_ms is not null and (p_response_time_ms < 0 or p_response_time_ms > 80000) then
    raise exception 'Invalid provider response time';
  end if;
  select * into w from public.pa_cloud_worker where singleton for update;
  if p_token is null or w.token is null or w.token is distinct from p_token
     or w.lease_until is null or w.lease_until <= now() then
    raise exception 'Stale cloud worker lease';
  end if;
  select * into j from public.pa_discovery_jobs where id = p_job for update;
  if j.id is null or j.status <> 'running' or j.lease_until <= now() then
    update public.pa_cloud_worker
       set token = null, lease_until = null, last_finished_at = now(),
           last_heartbeat_at = now(), lifecycle_state = 'failed'
     where singleton;
    return jsonb_build_object('stopped', true);
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > j.max_results then
    raise exception 'Invalid bounded result set';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    if r->>'provider' <> 'openstreetmap' or coalesce(r->>'name','') = ''
       or (r->>'source_id') !~ '^(node|way|relation)/[0-9]+$'
       or r->>'source_url' is distinct from ('https://www.openstreetmap.org/' || (r->>'source_id'))
       or coalesce(r->>'fingerprint','') !~ '^[a-f0-9]{64}$' then
      raise exception 'Invalid source record';
    end if;
    b := null;
    select id into b from public.pa_businesses where user_id = j.user_id and (
      (provider = 'openstreetmap' and source_id = r->>'source_id') or fingerprint = r->>'fingerprint' or
      (lower(regexp_replace(normalize(name,NFKC),'[^[:alnum:]]','','g')) = lower(regexp_replace(normalize(r->>'name',NFKC),'[^[:alnum:]]','','g')) and (
        (length(regexp_replace(coalesce(r->>'phone',''),'[^0-9]','','g')) >= 8 and regexp_replace(coalesce(phone,''),'[^0-9]','','g') = regexp_replace(r->>'phone','[^0-9]','','g')) or
        (lower(city) = lower(j.city) and coalesce(lower(regexp_replace((regexp_match(website,'^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\\.','','i')),'') <> '' and lower(regexp_replace((regexp_match(website,'^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\\.','','i')) = lower(regexp_replace((regexp_match(r->>'website','^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\\.','','i')))
      ))) order by created_at limit 1;
    if b is null then
      insert into public.pa_businesses(user_id,job_id,name,category,city,country,phone,email,website,source_id,source_url,provider,fingerprint,facts)
      values(j.user_id,j.id,r->>'name',j.category,j.city,j.country,r->>'phone',r->>'email',r->>'website',r->>'source_id',r->>'source_url','openstreetmap',r->>'fingerprint',r->'facts')
      on conflict do nothing returning id into b;
      if b is not null then
        added := added + 1;
      else
        select id into b from public.pa_businesses where user_id = j.user_id
          and ((provider = 'openstreetmap' and source_id = r->>'source_id') or fingerprint = r->>'fingerprint')
          order by created_at limit 1;
      end if;
    end if;
    if b is null then raise exception 'Unable to reconcile source identity'; end if;
    insert into public.pa_business_sources(user_id,business_id,url,provider,data)
    values(j.user_id,b,r->>'source_url','openstreetmap',r->'facts') on conflict do nothing;
    if coalesce((j.requirements->>'website_review')::boolean,false)
       and not exists(select 1 from public.pa_verification_runs where business_id = b) then
      insert into public.pa_verification_runs(user_id,business_id,status,evidence,explanation,completed_at)
      values(j.user_id,b,'completed',jsonb_build_array(
        jsonb_build_object('type','Public listing','url',r->>'source_url','timestamp',stamp,'detail','Observed a public OSM listing. Listing existence does not establish current operation.'),
        jsonb_build_object('type','Cloud review scope','url',r->>'source_url','timestamp',stamp,'detail',review_note)
      ),review_note,now()) returning id into run_id;
      update public.pa_businesses
         set activity_status = 'manual_review', website_status = 'manual_review',
             activity_confidence = 20, website_confidence = 20,
             verification_status = 'Manual review required'
       where id = b and activity_status = 'unverified' and website_status = 'unverified';
    end if;
    n := n + 1;
  end loop;

  update public.pa_discovery_jobs
     set status = 'completed', processed = n, total = n,
         result_count = n, duplicate_count = n - added,
         response_time_ms = p_response_time_ms, error = null, error_category = null,
         completed_at = now(), lease_until = null,
         logs = logs || jsonb_build_array(stamp || ' Completed: ' || n || ' real source records reviewed; ' || added || ' new businesses saved; ' || (n - added) || ' duplicates reconciled. Listing-only cloud review; activity and website ownership/absence require human review.')
   where id = j.id;
  insert into public.pa_audit_logs(user_id,action,entity_id,detail)
  values(j.user_id,'cloud_discovery_completed',j.id,jsonb_build_object('source_records',n,'inserted',added,'duplicates',n-added,'response_time_ms',p_response_time_ms,'mode','listing-only'));
  update public.pa_cloud_worker
     set token = null, lease_until = null, last_finished_at = now(),
         last_heartbeat_at = now(), last_successful_at = now(),
         last_successful_job_at = now(), last_error = null, last_error_category = null,
         lifecycle_state = 'completed'
   where singleton;
  return jsonb_build_object('processed',n,'inserted',added,'duplicates',n-added,'response_time_ms',p_response_time_ms);
end;
$$;
revoke all on function public.pa_cloud_commit(uuid,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.pa_cloud_commit(uuid,uuid,jsonb,integer) to service_role;

-- Permanent access/policy rejections are blocked; only network/timeout/5xx and
-- 429 failures can retry. A 406 therefore cannot silently consume retries.
drop function if exists public.pa_cloud_fail(uuid,uuid,text);
create function public.pa_cloud_fail(
  p_job uuid,
  p_token uuid,
  p_error text,
  p_error_category text default 'internal',
  p_response_time_ms integer default null,
  p_worker_version text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.pa_cloud_worker;
  j public.pa_discovery_jobs;
  category text;
  next_status text;
  retry_seconds integer;
  reason text;
begin
  -- Classify trusted worker metadata, but also inspect the bounded error text so
  -- a rolling deploy with the prior three-argument worker RPC cannot accidentally
  -- retry a recorded HTTP 406 before the new Edge bundle is live.
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
  select * into w from public.pa_cloud_worker where singleton for update;
  if p_token is null or w.token is null or w.token is distinct from p_token then return; end if;
  select * into j from public.pa_discovery_jobs where id = p_job for update;
  if j.id is null or j.status <> 'running' then
    -- A user may pause/cancel after the provider request begins. Consume this
    -- token without touching that job so the singleton is not needlessly held
    -- until lease expiry and no stale failure can change a user-controlled state.
    update public.pa_cloud_worker
       set token = null, lease_until = null, last_finished_at = now(),
           last_heartbeat_at = now(), lifecycle_state = case
             when not enabled and lifecycle_state = 'blocked' then 'blocked'
             when not enabled then 'paused'
             else 'reachable'
           end
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
         response_time_ms = coalesce(p_response_time_ms, response_time_ms),
         completed_at = case when next_status in ('blocked','failed') then now() else null end,
         lease_until = null,
         next_retry_at = case when retry_seconds > 0 then now() + make_interval(secs => retry_seconds) else next_retry_at end,
         worker_version = coalesce(nullif(p_worker_version,''), worker_version),
         logs = logs || jsonb_build_array(now()::text || ' Cloud attempt failed (' || category || '): ' || reason)
   where id = j.id;

  update public.pa_cloud_worker
     set token = null,
         lease_until = null,
         last_finished_at = now(),
         last_heartbeat_at = now(),
         last_error = reason,
         last_error_category = category,
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
revoke all on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.pa_cloud_fail(uuid,uuid,text,text,integer,text) to service_role;

create or replace function public.pa_cloud_pause_source(p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pa_cloud_worker
     set enabled = false,
         lifecycle_state = 'blocked',
         last_finished_at = case when token is null or lease_until is null or lease_until <= now() then now() else last_finished_at end,
         last_heartbeat_at = now(),
         last_error = left(coalesce(nullif(trim(p_error), ''), 'Discovery source is not ready.'), 500),
         last_error_category = 'provider_blocked',
         last_provider_error = left(coalesce(nullif(trim(p_error), ''), 'Discovery source is not ready.'), 500)
   where singleton;
end;
$$;
revoke all on function public.pa_cloud_pause_source(text) from public, anon, authenticated;
grant execute on function public.pa_cloud_pause_source(text) to service_role;

-- The scheduler only wakes the Edge worker for eligible queued/rate-limited
-- work or safe lease recovery. Blocked/paused jobs never invoke a provider.
create or replace function public.pa_cloud_tick() returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare request_id bigint; secret text;
begin
  if not exists(select 1 from public.pa_cloud_worker where singleton and enabled) then return null; end if;
  perform public.pa_cloud_review_queued();
  if exists(select 1 from public.pa_cloud_worker where singleton and last_maintenance is distinct from (now() at time zone 'UTC')::date) then
    perform public.pa_purge_expired();
    update public.pa_cloud_worker set last_maintenance = (now() at time zone 'UTC')::date where singleton;
  end if;
  if not exists(select 1 from public.pa_cloud_worker where singleton and enabled
     and coalesce(lease_until,'-infinity'::timestamptz) < now() and next_allowed_at <= now()
     and (budget_date <> (now() at time zone 'UTC')::date or daily_attempts < daily_limit)) then
    return null;
  end if;
  if not exists(select 1 from public.pa_discovery_jobs where
     (status in ('queued','rate_limited') and attempts < 3 and next_retry_at <= now())
     or (status = 'running' and lease_until < now())) then
    return null;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'pa_cloud_worker_token';
  if secret is null then raise exception 'Cloud scheduler token is not configured'; end if;
  select net.http_post(
    url := 'https://vfplvwtububtaovyalgu.supabase.co/functions/v1/prospectai-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-worker-token',secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 100000
  ) into request_id;
  return request_id;
end;
$$;
revoke all on function public.pa_cloud_tick() from public, anon, authenticated;
grant execute on function public.pa_cloud_tick() to service_role;

-- Health status is aggregate-only: no token, tenant identity, query, contact,
-- endpoint path, or result rows are returned to authenticated workspaces.
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
       'response_time_ms', j.response_time_ms, 'status', j.status
     )) from public.pa_discovery_jobs j
     where j.status in ('failed','blocked') and j.completed_at is not null
     order by j.completed_at desc limit 1
   ),
   'interval_minutes', 5
 ) from public.pa_cloud_worker w where w.singleton;
$$;
revoke all on function public.pa_cloud_worker_status() from public, anon;
grant execute on function public.pa_cloud_worker_status() to authenticated, service_role;
