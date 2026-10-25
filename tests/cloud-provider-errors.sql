-- Transactional tests only. No external HTTP; original queues/state restored.
begin;
do $$
declare u uuid:=gen_random_uuid(); j uuid; c jsonb;
begin
 update public.pa_discovery_jobs set status='paused' where status in ('queued','running');
 insert into auth.users(id,email) values(u,'provider-errors-rollback@test.invalid');
 insert into public.pa_discovery_jobs(user_id,country,city,category,max_results) values(u,'Pakistan','Karachi','dentist',2) returning id into j;
 update public.pa_cloud_worker set enabled=true,token=null,lease_until=null,next_allowed_at=now()-interval '1 minute',
 budget_date=(now() at time zone 'UTC')::date,daily_attempts=0;
 c:=public.pa_cloud_claim();
 perform public.pa_cloud_fail(j,(c->>'token')::uuid,'OpenStreetMap provider returned HTTP 406. Respect endpoint rate limits and retry later.');
 if (select enabled from public.pa_cloud_worker) or (select status from public.pa_discovery_jobs where id=j)<>'failed' then
   raise exception 'Permanent provider rejection was retried';
 end if;
 if public.pa_cloud_tick() is not null then raise exception 'Paused scheduler dispatched'; end if;
 insert into public.pa_discovery_jobs(user_id,country,city,category,max_results) values(u,'Pakistan','Karachi','cafe',2) returning id into j;
 update public.pa_cloud_worker set enabled=true,next_allowed_at=now()-interval '1 minute';
 c:=public.pa_cloud_claim();
 perform public.pa_cloud_fail(j,(c->>'token')::uuid,'OpenStreetMap provider returned HTTP 429. Respect endpoint rate limits and retry later.');
 if not (select enabled from public.pa_cloud_worker) or (select status from public.pa_discovery_jobs where id=j)<>'queued' or
    (select next_retry_at from public.pa_discovery_jobs where id=j)<now()+interval '5 minutes' then
   raise exception 'Retryable failure did not back off';
 end if;
 if exists(select 1 from public.pa_businesses where user_id=u) then raise exception 'Failure created business evidence'; end if;
end $$;
select 'PASS: permanent rejection pauses scheduling; 429 backs off; no false evidence' as result;
rollback;
