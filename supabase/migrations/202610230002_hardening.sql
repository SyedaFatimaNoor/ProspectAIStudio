-- Idempotence, relationship query indexes, append-only audit access.
create unique index pa_verification_active on public.pa_verification_runs(business_id) where status in ('queued','running');
create unique index pa_source_identity on public.pa_business_sources(business_id,provider,url);
create index on public.pa_business_sources(business_id);
create index on public.pa_verification_runs(business_id,created_at desc);
create index on public.pa_website_candidates(business_id);
create index on public.pa_proposals(business_id);
create index on public.pa_outreach_messages(business_id);
create index on public.pa_outreach_events(message_id);
drop policy own_rows on public.pa_audit_logs;
create policy read_own_audit on public.pa_audit_logs for select to authenticated using(user_id=(select auth.uid()));
create policy append_own_audit on public.pa_audit_logs for insert to authenticated with check(user_id=(select auth.uid()));
create or replace function public.pa_normalise_suppression() returns trigger language plpgsql set search_path=public as $$ begin new.contact=lower(trim(new.contact)); return new; end $$;
create trigger normalise_suppression before insert or update on public.pa_suppression_records for each row execute function public.pa_normalise_suppression();
