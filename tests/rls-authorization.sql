-- Non-production RLS integration test. Run only after applying every migration.
-- It creates two fictional auth users/records inside one transaction, then ROLLBACK
-- removes them. It must never be run against a production project.
begin;
select set_config('pa.rls_a', gen_random_uuid()::text, true),
       set_config('pa.rls_b', gen_random_uuid()::text, true),
       set_config('pa.rls_business_b', gen_random_uuid()::text, true),
       set_config('pa.rls_job_b', gen_random_uuid()::text, true);
insert into auth.users(id,email) values
 (current_setting('pa.rls_a')::uuid,'prospectai-rls-a@test.invalid'),
 (current_setting('pa.rls_b')::uuid,'prospectai-rls-b@test.invalid');

-- These are fictional fixtures, not real leads. The app has personal
-- workspaces: user_id is the only tenant boundary; there is no trusted
-- client-selectable workspace table/id.
insert into public.pa_businesses(user_id,name,category,city,country,source_id,provider,fingerprint)
values (current_setting('pa.rls_a')::uuid,'TEST ONLY A','cafe','Test City','Test Country','test/a','test',repeat('a',64)),
       (current_setting('pa.rls_b')::uuid,'TEST ONLY B','cafe','Test City','Test Country','test/b','test',repeat('b',64));
update public.pa_businesses set id=current_setting('pa.rls_business_b')::uuid
where user_id=current_setting('pa.rls_b')::uuid;
insert into public.pa_discovery_jobs(id,user_id,country,city,category,max_results)
values(current_setting('pa.rls_job_b')::uuid,current_setting('pa.rls_b')::uuid,'Test Country','Test City','cafe',1);
insert into public.pa_business_sources(user_id,business_id,url,provider,data)
values(current_setting('pa.rls_b')::uuid,current_setting('pa.rls_business_b')::uuid,'https://example.invalid/b','test','{}');
insert into public.pa_verification_runs(user_id,business_id,evidence)
values(current_setting('pa.rls_b')::uuid,current_setting('pa.rls_business_b')::uuid,'[{"type":"test","timestamp":"2026-01-01T00:00:00Z"}]');
insert into public.pa_proposals(user_id,business_id,title,content)
values(current_setting('pa.rls_b')::uuid,current_setting('pa.rls_business_b')::uuid,'TEST ONLY B concept','Not a real website concept.');
insert into public.pa_outreach_messages(user_id,business_id,channel,recipient,body)
values(current_setting('pa.rls_b')::uuid,current_setting('pa.rls_business_b')::uuid,'email','b@test.invalid','TEST ONLY draft');
insert into public.pa_suppression_records(user_id,contact,reason)
values(current_setting('pa.rls_b')::uuid,'suppressed-b@test.invalid','TEST ONLY');

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('pa.rls_a'),true);
do $$
declare b uuid:=current_setting('pa.rls_business_b')::uuid; j uuid:=current_setting('pa.rls_job_b')::uuid; n int;
begin
 -- Reads also represent the API/CSV export scope: A must only see A rows.
 select count(*) into n from public.pa_businesses where provider='test'; if n<>1 then raise exception 'lead export/read isolation failed'; end if;
 if exists(select 1 from public.pa_businesses where id=b) then raise exception 'A read B lead'; end if;
 if exists(select 1 from public.pa_discovery_jobs where id=j) then raise exception 'A read B job'; end if;
 if exists(select 1 from public.pa_proposals where business_id=b) then raise exception 'A read B website concept/draft'; end if;
 if exists(select 1 from public.pa_business_sources where business_id=b) or exists(select 1 from public.pa_verification_runs where business_id=b) then raise exception 'A read B evidence'; end if;
 if exists(select 1 from public.pa_outreach_messages where business_id=b) or exists(select 1 from public.pa_suppression_records where user_id=current_setting('pa.rls_b')::uuid) then raise exception 'A read B outreach/suppression'; end if;
 update public.pa_businesses set notes='attack' where id=b; if found then raise exception 'A updated B lead'; end if;
 delete from public.pa_businesses where id=b; if found then raise exception 'A deleted B lead'; end if;
 begin
   insert into public.pa_businesses(user_id,name,category,city,country,source_id,provider,fingerprint)
   values(current_setting('pa.rls_b')::uuid,'ATTACK','cafe','Test','Test','attack','test',repeat('c',64));
   raise exception 'A inserted as B';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
