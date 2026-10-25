-- Run using an administrative SQL connection. Every fixture/change is rolled back.
-- No external HTTP requests are issued. The scheduler remains disabled outside this transaction.
begin;
do $$
declare u uuid:=gen_random_uuid(); other_u uuid:=gen_random_uuid(); j uuid; j2 uuid;
 c jsonb; result jsonb; rows jsonb; denied boolean; b uuid;
begin
 if has_function_privilege('anon','public.pa_cloud_claim()','execute') or
    has_function_privilege('authenticated','public.pa_cloud_commit(uuid,uuid,jsonb)','execute') or
    has_function_privilege('authenticated','public.pa_cloud_tick()','execute') or
    has_table_privilege('authenticated','public.pa_cloud_worker','update') then
   raise exception 'Privileged cloud controls are exposed';
 end if;
 -- Temporarily isolate the queue. ROLLBACK restores all actual user jobs.
 update public.pa_discovery_jobs set status='paused' where status in ('queued','running');
 insert into auth.users(id,email) values(u,'cloud-worker-rollback@test.invalid'),(other_u,'cloud-worker-other-rollback@test.invalid');
 insert into public.pa_discovery_jobs(user_id,country,city,category,max_results,requirements)
 values(u,'Pakistan','Karachi','dentist',2,'{"website_review":true}') returning id into j;
 update public.pa_cloud_worker set enabled=true,token=null,lease_until=null,next_allowed_at=now()-interval '1 minute',
 budget_date=(now() at time zone 'UTC')::date,daily_attempts=daily_limit;
 if public.pa_cloud_claim() is not null then raise exception 'Daily cap bypass'; end if;
 update public.pa_cloud_worker set daily_attempts=0;
 c:=public.pa_cloud_claim();
 if c->'job'->>'id'<>j::text then raise exception 'Wrong claim'; end if;
 if public.pa_cloud_claim() is not null then raise exception 'Overlapping lease allowed'; end if;
 denied:=false;
 begin perform public.pa_cloud_commit(j,gen_random_uuid(),'[]'); exception when others then denied:=true; end;
 if not denied then raise exception 'Stale token accepted'; end if;
 denied:=false;
 begin perform public.pa_cloud_commit(j,null,'[]'); exception when others then denied:=true; end;
 if not denied then raise exception 'Null token accepted'; end if;
 rows:=jsonb_build_array(
 jsonb_build_object('name','TEST Dental','source_id','node/1','provider','openstreetmap','source_url','https://www.openstreetmap.org/node/1',
 'fingerprint',repeat('a',64),'phone','+92 300 0000000','website','https://example.invalid','facts',jsonb_build_object('fixture',true)),
 jsonb_build_object('name','Test Dental!','source_id','node/2','provider','openstreetmap','source_url','https://www.openstreetmap.org/node/2',
 'fingerprint',repeat('b',64),'phone','+923000000000','website','https://www.example.invalid/about','facts',jsonb_build_object('fixture',true)));
 denied:=false;
 begin perform public.pa_cloud_commit(j,(c->>'token')::uuid,rows||rows); exception when others then denied:=true; end;
 if not denied then raise exception 'Result limit bypass'; end if;
 -- A malformed second record must roll back the first insert atomically.
 denied:=false;
 begin perform public.pa_cloud_commit(j,(c->>'token')::uuid,jsonb_build_array(rows->0,jsonb_build_object('name','Invalid'))); exception when others then denied:=true; end;
 if not denied or exists(select 1 from public.pa_businesses where user_id=u) then raise exception 'Partial commit'; end if;
 result:=public.pa_cloud_commit(j,(c->>'token')::uuid,rows);
 if (result->>'processed')::int<>2 or (result->>'inserted')::int<>1 then raise exception 'Dedup failed: %',result; end if;
 if (select count(*) from public.pa_business_sources where user_id=u)<>2 then raise exception 'Provenance lost'; end if;
 if exists(select 1 from public.pa_businesses where user_id=u and (activity_confidence<>20 or website_confidence<>20 or verification_status<>'Manual review required')) then raise exception 'Unsupported verification claim'; end if;
 if exists(select 1 from public.pa_businesses where job_id=j and user_id<>u) then raise exception 'Cross-tenant write'; end if;
 denied:=false;
 begin perform public.pa_cloud_commit(j,(c->>'token')::uuid,rows); exception when others then denied:=true; end;
 if not denied then raise exception 'Consumed token replayed'; end if;
 select id into b from public.pa_businesses where user_id=u;
 update public.pa_businesses set activity_status='verified_active',activity_confidence=85 where id=b;
 insert into public.pa_verification_runs(user_id,business_id) values(u,b);
 perform public.pa_cloud_review_queued();
 if (select activity_confidence from public.pa_businesses where id=b)<>85 then raise exception 'Human assessment overwritten'; end if;
 insert into public.pa_discovery_jobs(user_id,country,city,category,max_results) values(u,'Pakistan','Karachi','cafe',2) returning id into j2;
 update public.pa_cloud_worker set next_allowed_at=now()-interval '1 minute';
 c:=public.pa_cloud_claim();
 update public.pa_discovery_jobs set status='cancelled' where id=j2;
 result:=public.pa_cloud_commit(j2,(c->>'token')::uuid,rows);
 if result->>'stopped'<>'true' or (select status from public.pa_discovery_jobs where id=j2)<>'cancelled' then raise exception 'Cancellation ignored'; end if;
 if (select count(*) from public.pa_businesses where user_id=u)<>1 then raise exception 'Cancelled result written'; end if;
 -- No work and a cap must never issue an HTTP request, even without a Vault key.
 update public.pa_cloud_worker set daily_attempts=daily_limit;
 if public.pa_cloud_tick() is not null then raise exception 'Idle/capped tick invoked a function'; end if;
end $$;
select 'PASS: cloud ACLs, cap, lease, stale/null tokens, result bounds, atomic rollback, dedup/provenance, tenant ownership, conservative evidence, replay, human assessment preservation, cancellation and idle scheduling' as result;
rollback;
