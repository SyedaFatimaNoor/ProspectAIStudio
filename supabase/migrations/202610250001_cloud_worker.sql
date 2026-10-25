-- Free-tier-oriented cloud worker. No billing/plan changes are made.
-- Deliberately disabled until the Edge Function and private scheduler token exist.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table public.pa_cloud_worker (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 token uuid, lease_until timestamptz, next_allowed_at timestamptz not null default now(),
 budget_date date not null default (now() at time zone 'UTC')::date,
 daily_attempts int not null default 0,
 daily_limit int not null default 20 check(daily_limit between 1 and 20),
 last_started_at timestamptz, last_finished_at timestamptz, last_error text, last_maintenance date
);
insert into public.pa_cloud_worker(singleton) values(true);
alter table public.pa_cloud_worker enable row level security;
revoke all on public.pa_cloud_worker from anon,authenticated;
grant all on public.pa_cloud_worker to service_role;

create or replace function public.pa_cloud_worker_status() returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_build_object('enabled',enabled,'mode','listing-only','daily_limit',daily_limit,
 'daily_attempts',case when budget_date=(now() at time zone 'UTC')::date then daily_attempts else 0 end,
 'last_started_at',last_started_at,'last_finished_at',last_finished_at,
 'interval_minutes',5) from public.pa_cloud_worker where singleton;
$$;
revoke all on function public.pa_cloud_worker_status() from public,anon;
grant execute on function public.pa_cloud_worker_status() to authenticated,service_role;

-- A project-wide lease and daily cap prevent overlapping Edge invocations and
-- provider bursts. The lease is longer than the function's 80-second deadline.
create or replace function public.pa_cloud_claim() returns jsonb
language plpgsql security definer set search_path=public as $$
declare w public.pa_cloud_worker; j public.pa_discovery_jobs; t uuid;
begin
 select * into w from public.pa_cloud_worker where singleton for update;
 if not w.enabled or w.lease_until>now() or w.next_allowed_at>now() then return null; end if;
 if w.budget_date<>(now() at time zone 'UTC')::date then
   w.daily_attempts:=0;
 end if;
 if w.daily_attempts>=w.daily_limit then return null; end if;
 update public.pa_discovery_jobs set status='failed',lease_until=null,
 error='Worker lease expired after 3 attempts. Review logs before resuming.',
 logs=logs||jsonb_build_array(now()::text||' Cloud worker: retry limit reached.')
 where status='running' and lease_until<now() and attempts>=3;
 select * into j from public.pa_discovery_jobs
 where (status='queued' or (status='running' and lease_until<now()))
 and attempts<3 and next_retry_at<=now()
 order by created_at for update skip locked limit 1;
 if j.id is null then return null; end if;
 t:=gen_random_uuid();
 update public.pa_cloud_worker set token=t,lease_until=now()+interval '2 minutes',
 next_allowed_at=now()+interval '5 minutes',daily_attempts=w.daily_attempts+1,
 budget_date=(now() at time zone 'UTC')::date,last_started_at=now(),last_error=null
 where singleton;
 update public.pa_discovery_jobs set status='running',attempts=attempts+1,
 lease_until=now()+interval '2 minutes',
 logs=logs||jsonb_build_array(now()::text||' Cloud worker claimed job. Querying OpenStreetMap; listing-only review, not live website verification.')
 where id=j.id returning * into j;
 return jsonb_build_object('token',t,'job',to_jsonb(j));
end;
$$;
revoke all on function public.pa_cloud_claim() from public,anon,authenticated;
grant execute on function public.pa_cloud_claim() to service_role;

-- All results are committed together, after locking and rechecking the live job.
-- A pause/cancel/delete or expired/stale lease prevents EVERY result write.
-- An acknowledgement lost after commit is safe: the token is consumed atomically.
create or replace function public.pa_cloud_commit(p_job uuid,p_token uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.pa_cloud_worker; j public.pa_discovery_jobs; r jsonb;
 b uuid; run_id uuid; n int:=0; added int:=0; stamp text:=now()::text;
 review_note text:='Listing-only cloud review. No business website was fetched, no independent domain search was performed, and current operation, official ownership and website absence remain unverified. Manual review required.';
begin
 select * into w from public.pa_cloud_worker where singleton for update;
 if p_token is null or w.token is null or w.token is distinct from p_token or w.lease_until is null or w.lease_until<=now() then raise exception 'Stale cloud worker lease'; end if;
 select * into j from public.pa_discovery_jobs where id=p_job for update;
 if j.id is null or j.status<>'running' or j.lease_until<=now() then
   update public.pa_cloud_worker set token=null,lease_until=null,last_finished_at=now() where singleton;
   return jsonb_build_object('stopped',true);
 end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>j.max_results then
   raise exception 'Invalid bounded result set';
 end if;
 for r in select value from jsonb_array_elements(p_rows) loop
   if r->>'provider'<>'openstreetmap' or coalesce(r->>'name','')='' or
      (r->>'source_id') !~ '^(node|way|relation)/[0-9]+$' or
      r->>'source_url' is distinct from ('https://www.openstreetmap.org/'||(r->>'source_id')) or
      coalesce(r->>'fingerprint','') !~ '^[a-f0-9]{64}$' then
     raise exception 'Invalid source record';
   end if;
   b:=null;
   select id into b from public.pa_businesses where user_id=j.user_id and (
     (provider='openstreetmap' and source_id=r->>'source_id') or fingerprint=r->>'fingerprint' or
     (lower(regexp_replace(normalize(name,NFKC),'[^[:alnum:]]','','g'))=
      lower(regexp_replace(normalize(r->>'name',NFKC),'[^[:alnum:]]','','g')) and (
       (length(regexp_replace(coalesce(r->>'phone',''),'[^0-9]','','g'))>=8 and
        regexp_replace(coalesce(phone,''),'[^0-9]','','g')=regexp_replace(r->>'phone','[^0-9]','','g')) or
       (lower(city)=lower(j.city) and
        coalesce(lower(regexp_replace((regexp_match(website,'^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\.','','i')),'')<>'' and
        lower(regexp_replace((regexp_match(website,'^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\.','','i'))=
        lower(regexp_replace((regexp_match(r->>'website','^https?://(?:[^/@]+@)?([^/:?#]+)','i'))[1],'^www\.','','i')))
     ))) order by created_at limit 1;
   if b is null then
   insert into public.pa_businesses(user_id,job_id,name,category,city,country,phone,email,website,
     source_id,source_url,provider,fingerprint,facts)
   values(j.user_id,j.id,r->>'name',j.category,j.city,j.country,r->>'phone',r->>'email',r->>'website',
     r->>'source_id',r->>'source_url','openstreetmap',r->>'fingerprint',r->'facts')
   on conflict do nothing returning id into b;
   if b is not null then added:=added+1; else
     select id into b from public.pa_businesses where user_id=j.user_id and
       ((provider='openstreetmap' and source_id=r->>'source_id') or fingerprint=r->>'fingerprint')
     order by created_at limit 1;
   end if;
   end if;
   if b is null then raise exception 'Unable to reconcile source identity'; end if;
   insert into public.pa_business_sources(user_id,business_id,url,provider,data)
   values(j.user_id,b,r->>'source_url','openstreetmap',r->'facts') on conflict do nothing;
   -- Never replace prior human assessments on a duplicate business.
   if coalesce((j.requirements->>'website_review')::boolean,false) and
      not exists(select 1 from public.pa_verification_runs where business_id=b) then
     insert into public.pa_verification_runs(user_id,business_id,status,evidence,explanation,completed_at)
     values(j.user_id,b,'completed',jsonb_build_array(
       jsonb_build_object('type','Public listing','url',r->>'source_url','timestamp',stamp,
         'detail','Observed a public OSM listing. Listing existence does not establish current operation.'),
       jsonb_build_object('type','Cloud review scope','url',r->>'source_url','timestamp',stamp,
         'detail',review_note)
     ),review_note,now()) returning id into run_id;
     update public.pa_businesses set activity_status='manual_review',website_status='manual_review',
       activity_confidence=20,website_confidence=20,verification_status='Manual review required'
     where id=b and activity_status='unverified' and website_status='unverified';
   end if;
   n:=n+1;
 end loop;
 update public.pa_discovery_jobs set status='completed',processed=n,total=n,error=null,lease_until=null,
 logs=logs||jsonb_build_array(stamp||' Completed: '||n||' real source records reviewed; '||added||' new businesses saved. Listing-only cloud review; activity and website ownership/absence require human review.')
 where id=j.id;
 insert into public.pa_audit_logs(user_id,action,entity_id,detail)
 values(j.user_id,'cloud_discovery_completed',j.id,jsonb_build_object('source_records',n,'inserted',added,'mode','listing-only'));
 update public.pa_cloud_worker set token=null,lease_until=null,last_finished_at=now(),last_error=null where singleton;
 return jsonb_build_object('processed',n,'inserted',added);
end;
$$;
revoke all on function public.pa_cloud_commit(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.pa_cloud_commit(uuid,uuid,jsonb) to service_role;

create or replace function public.pa_cloud_fail(p_job uuid,p_token uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare w public.pa_cloud_worker;
begin
 select * into w from public.pa_cloud_worker where singleton for update;
 if p_token is null or w.token is null or w.token is distinct from p_token then return; end if;
 update public.pa_discovery_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,
 error=left(p_error,500),lease_until=null,next_retry_at=now()+interval '5 minutes',
 logs=logs||jsonb_build_array(now()::text||' Cloud attempt failed: '||left(p_error,500))
 where id=p_job and status='running';
 update public.pa_cloud_worker set token=null,lease_until=null,last_finished_at=now(),last_error=left(p_error,500) where singleton;
end;
$$;
revoke all on function public.pa_cloud_fail(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pa_cloud_fail(uuid,uuid,text) to service_role;

-- Explicitly source-only: queued evidence reviews must not hang indefinitely.
-- No HTTP/DNS checks are implied by a completed listing review. Preserve human
-- assessments and never promote a listing into active/no-website confidence.
create or replace function public.pa_cloud_review_queued() returns void
language plpgsql security definer set search_path=public as $$
declare v record; note text:='Listing-only cloud review. No website fetch or independent domain search was performed. Current operation, website ownership and website absence require manual evidence review.';
begin
 for v in select r.id,r.business_id,r.user_id,b.source_url from public.pa_verification_runs r
 join public.pa_businesses b on b.id=r.business_id and b.user_id=r.user_id
 where r.status='queued' order by r.created_at for update of r skip locked limit 5 loop
   update public.pa_businesses set activity_status='manual_review',website_status='manual_review',
     activity_confidence=20,website_confidence=20,verification_status='Manual review required'
   where id=v.business_id and activity_status='unverified' and website_status='unverified';
   update public.pa_verification_runs set status='completed',completed_at=now(),lease_until=null,error=null,
     evidence=jsonb_build_array(jsonb_build_object('type','Cloud review scope','url',v.source_url,
       'timestamp',now(),'detail',note)),explanation=note where id=v.id;
 end loop;
end;
$$;
revoke all on function public.pa_cloud_review_queued() from public,anon,authenticated;
grant execute on function public.pa_cloud_review_queued() to service_role;

-- Schedule only when due work exists. No idle Edge invocations. The callback
-- secret lives in Vault, never SQL source, job logs, browser config, or cron text.
create or replace function public.pa_cloud_tick() returns bigint
language plpgsql security definer set search_path=public as $$
declare request_id bigint; secret text;
begin
 if not exists(select 1 from public.pa_cloud_worker where singleton and enabled) then return null; end if;
 perform public.pa_cloud_review_queued();
 if exists(select 1 from public.pa_cloud_worker where singleton and last_maintenance is distinct from (now() at time zone 'UTC')::date) then
   perform public.pa_purge_expired();
   update public.pa_cloud_worker set last_maintenance=(now() at time zone 'UTC')::date where singleton;
 end if;
 if not exists(select 1 from public.pa_cloud_worker where singleton and enabled
   and coalesce(lease_until,'-infinity'::timestamptz)<now() and next_allowed_at<=now()
   and (budget_date<>(now() at time zone 'UTC')::date or daily_attempts<daily_limit)) then return null; end if;
 if not exists(select 1 from public.pa_discovery_jobs where
   (status='queued' and attempts<3 and next_retry_at<=now()) or
   (status='running' and lease_until<now())) then return null; end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name='pa_cloud_worker_token';
 if secret is null then raise exception 'Cloud scheduler token is not configured'; end if;
 select net.http_post(
   url := 'https://vfplvwtububtaovyalgu.supabase.co/functions/v1/prospectai-worker',
   headers := jsonb_build_object('Content-Type','application/json','x-worker-token',secret),
   body := '{}'::jsonb, timeout_milliseconds := 100000
 ) into request_id;
 return request_id;
end;
$$;
revoke all on function public.pa_cloud_tick() from public,anon,authenticated;
grant execute on function public.pa_cloud_tick() to service_role;
select cron.schedule('prospectai-cloud-worker','*/5 * * * *','select public.pa_cloud_tick()');
