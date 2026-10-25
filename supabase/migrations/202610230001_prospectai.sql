-- ProspectAI's pa_ namespace deliberately preserves pre-existing public tables.
create table public.pa_profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.pa_discovery_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 country text not null, city text not null, category text not null, keywords text not null default '', service_area text not null default '',
 max_results int not null check(max_results between 1 and 100), provider text not null default 'openstreetmap',
 requirements jsonb not null default '{}', status text not null default 'queued' check(status in ('queued','running','paused','cancelled','completed','failed')),
 processed int not null default 0, total int not null default 0, attempts int not null default 0, error text,
 logs jsonb not null default '[]', lease_until timestamptz, next_retry_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table public.pa_businesses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid, name text not null, category text not null, city text not null, country text not null,
 phone text, email text, website text, source_url text, source_id text not null, provider text not null,
 fingerprint text not null, activity_status text not null default 'unverified', website_status text not null default 'unverified',
 activity_confidence int not null default 0 check(activity_confidence between 0 and 100), website_confidence int not null default 0 check(website_confidence between 0 and 100),
 verification_status text not null default 'Unverified', outreach_status text not null default 'Not contacted', notes text not null default '',
 facts jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), unique(user_id,provider,source_id), unique(user_id,fingerprint),
 foreign key(job_id,user_id) references public.pa_discovery_jobs(id,user_id) on delete cascade
);
create table public.pa_business_sources (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, business_id uuid not null,
 url text not null, provider text not null, data jsonb not null default '{}', observed_at timestamptz not null default now(),
 foreign key(business_id,user_id) references public.pa_businesses(id,user_id) on delete cascade
);
create table public.pa_verification_runs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, business_id uuid not null,
 status text not null default 'queued', evidence jsonb not null default '[]', explanation text not null default '', error text,
 attempts int not null default 0, lease_until timestamptz, created_at timestamptz not null default now(), completed_at timestamptz,
 unique(id,user_id), foreign key(business_id,user_id) references public.pa_businesses(id,user_id) on delete cascade
);
create table public.pa_website_candidates (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, business_id uuid not null,
 run_id uuid not null, url text not null, classification text not null, result jsonb not null default '{}', checked_at timestamptz not null default now(),
 foreign key(business_id,user_id) references public.pa_businesses(id,user_id) on delete cascade,
 foreign key(run_id,user_id) references public.pa_verification_runs(id,user_id) on delete cascade
);
create table public.pa_proposals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, business_id uuid not null,
 title text not null, content text not null, version int not null default 1, origin text not null default 'manual',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(business_id,user_id) references public.pa_businesses(id,user_id) on delete cascade
);
create table public.pa_outreach_messages (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, business_id uuid not null,
 channel text not null check(channel in ('email','whatsapp')), recipient text not null, subject text not null default '', body text not null,
 status text not null default 'draft' check(status in ('draft','approved','suppressed','sent','failed')), lawful_basis text not null default '',
 approved_at timestamptz, sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id),
 foreign key(business_id,user_id) references public.pa_businesses(id,user_id) on delete cascade
);
create table public.pa_outreach_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade, message_id uuid not null,
 event_type text not null, detail text not null default '', created_at timestamptz not null default now(),
 foreign key(message_id,user_id) references public.pa_outreach_messages(id,user_id) on delete cascade
);
create table public.pa_suppression_records (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 contact text not null, reason text not null, created_at timestamptz not null default now(), unique(user_id,contact)
);
create table public.pa_integration_settings (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 search_limit int not null default 25 check(search_limit between 1 and 100), verification_threshold int not null default 85 check(verification_threshold between 50 and 100),
 retention_days int not null default 90 check(retention_days between 7 and 365), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id)
);
create table public.pa_audit_logs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 action text not null, entity_id uuid, detail jsonb not null default '{}', created_at timestamptz not null default now()
);
-- All application tables are tenant isolated. Composite foreign keys prevent cross-tenant associations.
do $$ declare t text; begin
 foreach t in array array['profiles','discovery_jobs','businesses','business_sources','verification_runs','website_candidates','proposals','outreach_messages','outreach_events','suppression_records','integration_settings','audit_logs'] loop
 execute format('alter table public.pa_%I enable row level security',t);
 if t='profiles' then
 execute 'create policy own_profile on public.pa_profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()))';
 else
 execute format('create policy own_rows on public.pa_%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',t);
 execute format('create index on public.pa_%I(user_id)',t);
 end if;
 end loop;
end $$;
create index on public.pa_businesses(user_id,created_at desc);
create index on public.pa_businesses(user_id,verification_status);
create index on public.pa_discovery_jobs(status,next_retry_at);
create index on public.pa_verification_runs(status,created_at);
create or replace function public.pa_touch() returns trigger language plpgsql set search_path = public as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['profiles','discovery_jobs','businesses','proposals','outreach_messages','integration_settings'] loop execute format('create trigger touch before update on public.pa_%I for each row execute function public.pa_touch()',t); end loop; end $$;
-- Atomic leases make worker restarts and multiple worker processes safe.
create or replace function public.pa_claim_job() returns setof public.pa_discovery_jobs language sql security definer set search_path=public as $$
 update public.pa_discovery_jobs set status='running',lease_until=now()+interval '2 minutes',attempts=attempts+1
 where id=(select id from public.pa_discovery_jobs where (status='queued' or (status='running' and lease_until<now())) and next_retry_at<=now() and attempts<3 order by created_at for update skip locked limit 1) returning *;
$$;
revoke all on function public.pa_claim_job() from public,anon,authenticated;
grant execute on function public.pa_claim_job() to service_role;
-- Suppression and draft-only mode are enforced in the database, not only in the UI.
create or replace function public.pa_message_guard() returns trigger language plpgsql set search_path=public as $$
begin
 new.recipient=lower(trim(new.recipient));
 if new.status='sent' then raise exception 'Sending is disabled: draft-only mode'; end if;
 if new.status='approved' and (new.approved_at is null or length(trim(new.lawful_basis))<10) then raise exception 'Approval and a documented lawful basis are required'; end if;
 if exists(select 1 from public.pa_suppression_records where user_id=new.user_id and contact=new.recipient) then new.status='suppressed'; new.approved_at=null; end if;
 return new;
end $$;
create trigger message_guard before insert or update on public.pa_outreach_messages for each row execute function public.pa_message_guard();
create or replace function public.pa_suppress() returns trigger language plpgsql set search_path=public as $$ begin
 update public.pa_outreach_messages set status='suppressed',approved_at=null where user_id=new.user_id and lower(trim(recipient))=new.contact; return new; end $$;
create trigger suppress_messages after insert on public.pa_suppression_records for each row execute function public.pa_suppress();
