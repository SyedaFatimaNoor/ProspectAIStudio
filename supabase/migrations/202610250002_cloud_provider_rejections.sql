-- Permanent provider rejections require operator action, not retries/mirror
-- rotation. In particular, never spend quota repeatedly hitting a denied API.
create or replace function public.pa_cloud_fail(p_job uuid,p_token uuid,p_error text)
returns void language plpgsql security definer set search_path=public as $$
declare w public.pa_cloud_worker;
 rejected boolean := p_error ~ '^OpenStreetMap provider returned HTTP (400|401|403|404|405|406|410|422)\.';
 reason text;
begin
 select * into w from public.pa_cloud_worker where singleton for update;
 if p_token is null or w.token is null or w.token is distinct from p_token then return; end if;
 reason:=left(p_error,350)||case when rejected then ' Cloud scheduling paused. Review provider policy/configuration; no endpoint rotation or bypass was attempted.' else '' end;
 update public.pa_discovery_jobs set status=case when attempts>=3 or rejected then 'failed' else 'queued' end,
 error=reason,lease_until=null,
 next_retry_at=now()+make_interval(secs=>300*power(2,greatest(0,least(attempts-1,2)))::int),
 logs=logs||jsonb_build_array(now()::text||' Cloud attempt failed: '||reason)
 where id=p_job and status='running';
 update public.pa_cloud_worker set token=null,lease_until=null,last_finished_at=now(),last_error=reason,
 enabled=case when rejected then false else enabled end where singleton;
end;
$$;
revoke all on function public.pa_cloud_fail(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.pa_cloud_fail(uuid,uuid,text) to service_role;

-- Reconcile an already-observed rejection from deployment validation. This does
-- not create evidence or pretend a source query completed. Existing rows remain.
do $$
begin
 if exists(select 1 from public.pa_discovery_jobs where status='queued' and error ~ '^OpenStreetMap provider returned HTTP (400|401|403|404|405|406|410|422)\.') then
   update public.pa_cloud_worker set enabled=false,
     last_error='Provider rejected a cloud request. Scheduling paused pending a permitted, accepting endpoint.' where singleton;
   update public.pa_discovery_jobs set status='failed',lease_until=null,
     logs=logs||jsonb_build_array(now()::text||' Cloud scheduling paused after provider rejection. No results were saved. Review provider configuration before resuming.')
   where status='queued' and error ~ '^OpenStreetMap provider returned HTTP (400|401|403|404|405|406|410|422)\.';
 end if;
end $$;
