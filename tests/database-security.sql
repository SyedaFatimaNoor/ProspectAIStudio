-- Run in the Supabase SQL editor as an administrator. Every fixture is rolled back.
-- These fictional test records are NOT real leads and must never be committed.
begin;
select set_config('pa.test_a',gen_random_uuid()::text,true), set_config('pa.test_b',gen_random_uuid()::text,true),set_config('pa.test_business_b',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('pa.test_a')::uuid),(current_setting('pa.test_b')::uuid);
insert into public.pa_businesses(user_id,name,category,city,country,source_id,provider,fingerprint)
values(current_setting('pa.test_a')::uuid,'TEST FIXTURE A — NOT A REAL BUSINESS','cafe','Test','Test','test/a','test','test-a');
insert into public.pa_businesses(id,user_id,name,category,city,country,source_id,provider,fingerprint)
values(current_setting('pa.test_business_b')::uuid,current_setting('pa.test_b')::uuid,'TEST FIXTURE B — NOT A REAL BUSINESS','cafe','Test','Test','test/b','test','test-b');
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('pa.test_a'),true);
do $$ declare n int; m uuid; b uuid; begin
select count(*) into n from public.pa_businesses where provider='test'; if n<>1 then raise exception 'RLS FAILED: expected one visible fixture, got %',n; end if;
select id into b from public.pa_businesses where provider='test';
begin
 insert into public.pa_suppression_records(user_id,contact,reason) values(current_setting('pa.test_b')::uuid,'test@example.invalid','cross-tenant test');
 raise exception 'RLS FAILED: cross tenant insert allowed';
exception when insufficient_privilege then null; end;
begin
 insert into public.pa_proposals(user_id,business_id,title,content) values(current_setting('pa.test_a')::uuid,current_setting('pa.test_business_b')::uuid,'Test','TEST ONLY');
 raise exception 'RELATION FAILED: cross tenant association allowed';
exception when foreign_key_violation then null; end;
insert into public.pa_proposals(user_id,business_id,title,content) values(current_setting('pa.test_a')::uuid,b,'TEST ONLY','Draft concept — not a real proposal');
update public.pa_businesses set notes='TEST ONLY: persistence assertion' where id=b;
select count(*) into n from public.pa_businesses where id=b and notes='TEST ONLY: persistence assertion'; if n<>1 then raise exception 'NOTE PERSISTENCE FAILED'; end if;
insert into public.pa_outreach_messages(user_id,business_id,channel,recipient,body) values(current_setting('pa.test_a')::uuid,b,'email','test@example.invalid','TEST ONLY') returning id into m;
begin
 update public.pa_outreach_messages set status='sent' where id=m;
 raise exception 'SEND GUARD FAILED';
exception when raise_exception then if SQLERRM='SEND GUARD FAILED' then raise; end if; end;
begin
 update public.pa_outreach_messages set status='approved' where id=m;
 raise exception 'APPROVAL GUARD FAILED';
exception when raise_exception then if SQLERRM='APPROVAL GUARD FAILED' then raise; end if; end;
update public.pa_outreach_messages set status='approved',approved_at=now(),lawful_basis='TEST ONLY: simulated permission for a rollback test' where id=m;
select count(*) into n from public.pa_outreach_messages where id=m and status='approved'; if n<>1 then raise exception 'APPROVAL PERSISTENCE FAILED'; end if;
insert into public.pa_suppression_records(user_id,contact,reason) values(current_setting('pa.test_a')::uuid,' TEST@EXAMPLE.INVALID ','test opt-out');
select count(*) into n from public.pa_outreach_messages where id=m and status='suppressed'; if n<>1 then raise exception 'SUPPRESSION FAILED'; end if;
update public.pa_outreach_messages set status='approved',approved_at=now() where id=m;
select count(*) into n from public.pa_outreach_messages where id=m and status='suppressed'; if n<>1 then raise exception 'SUPPRESSION APPROVAL BLOCK FAILED'; end if;
insert into public.pa_audit_logs(user_id,action) values(current_setting('pa.test_a')::uuid,'TEST ONLY');
update public.pa_audit_logs set action='tampered' where user_id=current_setting('pa.test_a')::uuid;
select count(*) into n from public.pa_audit_logs where user_id=current_setting('pa.test_a')::uuid and action='TEST ONLY'; if n<>1 then raise exception 'AUDIT APPEND-ONLY FAILED'; end if;
delete from public.pa_businesses where id=b;
select count(*) into n from public.pa_proposals where business_id=b; if n<>0 then raise exception 'CASCADE FAILED'; end if;
select count(*) into n from public.pa_suppression_records where user_id=current_setting('pa.test_a')::uuid; if n<>1 then raise exception 'SUPPRESSION RETENTION FAILED'; end if;
end $$;
select 'PASS: tenant isolation, cross-tenant association denial, notes/proposal persistence, send/approval guards, opt-out normalisation and propagation, audit immutability, cascade deletion, suppression retention. All fixtures rolled back.' as test_result;
rollback;
