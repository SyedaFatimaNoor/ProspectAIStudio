-- Repository-side remediation for the 2026-11-07 QA audit. This migration is
-- intentionally not applied to production from the coding sandbox. It contains
-- schema-only changes and no credentials, user rows, leads, or business facts.

-- BUG-011: canonical country aliases for the OSM snapshot. Aliases are operator
-- metadata, not inferred business evidence.
create table if not exists public.pa_osm_country_aliases (
  alias text primary key,
  canonical_country text not null
);
alter table public.pa_osm_country_aliases enable row level security;
revoke all on public.pa_osm_country_aliases from anon, authenticated;
grant select on public.pa_osm_country_aliases to authenticated, service_role;
grant insert, update, delete on public.pa_osm_country_aliases to service_role;
insert into public.pa_osm_country_aliases(alias, canonical_country)
values
  ('turkey', 'Turkey'),
  ('tr', 'Turkey'),
  ('tur', 'Turkey'),
  ('türkiye', 'Turkey'),
  ('turkiye', 'Turkey')
on conflict (alias) do nothing;

-- BUG-012/BUG-011: guard the snapshot search inside the security-definer RPC
-- and normalise country aliases without widening the business result set.
create or replace function public.pa_osm_search(
 p_country text, p_city text, p_category text, p_limit int default 100)
returns table (
 id bigint, osm_type_id text, name text, phone text, email text, website text,
 street text, housenumber text, locality text, lat double precision,
 lon double precision, edit_at timestamptz, snapshot_date date, distance_km numeric)
language sql stable security definer set search_path = public as $$
 with requested as (
   select coalesce(
     (select canonical_country
        from public.pa_osm_country_aliases
       where alias = lower(btrim(coalesce(p_country, '')))),
     btrim(coalesce(p_country, ''))
   ) as country
 ), ready as (
   select s.status = 'ready'
      and s.places_imported > 0
      and s.businesses_imported > 0 as ok
   from public.pa_osm_snapshot_import_state s
   where s.singleton
 )
 select b.id, b.osm_type_id, b.name, b.phone, b.email, b.website,
        b.street, b.housenumber, b.locality, b.lat, b.lon,
        b.edit_at, b.snapshot_date,
        round(public.pa_osm_distance(c.lat,c.lon,b.lat,b.lon)::numeric,2) as distance_km
 from requested r
 cross join ready
 join public.pa_osm_places c
   on lower(c.country_code) = lower(r.country)
  and c.rank >= 2
  and (lower(c.name) = lower(p_city) or lower(coalesce(c.name_en,'')) = lower(p_city))
 join lateral public.pa_osm_place_scope(c.id) s on true
 join public.pa_osm_businesses b
   on b.app_category = p_category
  and b.place_ids && s.ids
  and lower(b.country_code) = lower(r.country)
 where ready.ok
 order by distance_km asc, b.id
 limit least(greatest(p_limit,1),100)
$$;
revoke all on function public.pa_osm_search(text,text,text,int) from public, anon, authenticated;
grant execute on function public.pa_osm_search(text,text,text,int) to service_role;

-- BUG-023: move the scheduler function URL out of SQL source into operator
-- config. The token remains in Vault and is never stored in this table.
create table if not exists public.pa_cloud_worker_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null,
  token_secret_name text not null default 'pa_cloud_worker_token',
  updated_at timestamptz not null default now()
);
alter table public.pa_cloud_worker_config enable row level security;
revoke all on public.pa_cloud_worker_config from anon, authenticated;
grant select on public.pa_cloud_worker_config to service_role;
grant insert, update on public.pa_cloud_worker_config to service_role;

-- BUG-008: preserve proposal revisions instead of overwriting the only row.
create table if not exists public.pa_proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid not null,
  version integer not null check (version >= 1),
  title text not null,
  content text not null,
  origin text not null,
  ai_provider text,
  ai_model text,
  generated_at timestamptz,
  ai_output jsonb,
  facts_snapshot jsonb,
  created_at timestamptz not null default now(),
  foreign key (proposal_id, user_id) references public.pa_proposals(id, user_id) on delete cascade
);
alter table public.pa_proposal_revisions enable row level security;
revoke all on public.pa_proposal_revisions from anon;
grant select, insert on public.pa_proposal_revisions to authenticated;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pa_proposal_revisions'
      and policyname = 'own_proposal_revisions'
  ) then
    create policy own_proposal_revisions
      on public.pa_proposal_revisions for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'pa_proposal_revisions'
      and policyname = 'insert_own_proposal_revisions'
  ) then
    create policy insert_own_proposal_revisions
      on public.pa_proposal_revisions for insert to authenticated
      with check (user_id = (select auth.uid()));
  end if;
end $$;

-- BUG-009: restore conservative tenant-scoped dedupe keys for non-duplicate
-- businesses only. Duplicate-review groups remain usable for reconciled rows.
create unique index if not exists pa_businesses_unique_source
  on public.pa_businesses(user_id, provider, source_id)
  where duplicate_group_id is null;
create unique index if not exists pa_businesses_unique_fingerprint
  on public.pa_businesses(user_id, fingerprint)
  where duplicate_group_id is null;

-- BUG-006: shared rate-limit counters for server-side enforcement when a
-- deployment opts into a database-backed limiter. No client identifiers or
-- secret values are stored; buckets are keyed by an opaque server hash.
create table if not exists public.pa_rate_limit_buckets (
  bucket_key text primary key,
  count integer not null default 0 check (count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.pa_rate_limit_buckets enable row level security;
revoke all on public.pa_rate_limit_buckets from anon, authenticated;
grant all on public.pa_rate_limit_buckets to service_role;

create or replace function public.pa_take_rate_limit(
  p_key text, p_limit integer, p_window_seconds integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare now_ts timestamptz := now();
       reset_ts timestamptz;
       current_count integer;
       allowed boolean;
begin
  if coalesce(length(btrim(p_key)), 0) = 0 or length(p_key) > 200 then
    raise exception 'Invalid rate-limit key';
  end if;
  if p_limit < 1 or p_limit > 100000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate-limit window';
  end if;
  insert into public.pa_rate_limit_buckets(bucket_key, count, reset_at)
  values (p_key, 0, now_ts + make_interval(secs => p_window_seconds))
  on conflict (bucket_key) do nothing;
  update public.pa_rate_limit_buckets
     set count = 0,
         reset_at = now_ts + make_interval(secs => p_window_seconds),
         updated_at = now_ts
   where bucket_key = p_key and reset_at <= now_ts;
  select reset_at, count into reset_ts, current_count
    from public.pa_rate_limit_buckets
   where bucket_key = p_key;
  allowed := current_count < p_limit;
  if allowed then
    update public.pa_rate_limit_buckets
       set count = count + 1, updated_at = now_ts
     where bucket_key = p_key;
    current_count := current_count + 1;
  end if;
  return jsonb_build_object(
    'allowed', allowed,
    'limit', p_limit,
    'remaining', greatest(p_limit - current_count, 0),
    'retryAfterSeconds', greatest(1, ceil(extract(epoch from (reset_ts - now_ts)))::integer)
  );
end $$;
revoke all on function public.pa_take_rate_limit(text,integer,integer) from public, anon, authenticated;
grant execute on function public.pa_take_rate_limit(text,integer,integer) to service_role;

-- BUG-023: replace the hardcoded scheduler URL with service-only config. The
-- operator must insert the reviewed HTTPS function URL; no default URL or token
-- is stored in migration source.
create or replace function public.pa_cloud_tick() returns bigint
language plpgsql security definer set search_path = public as $$
declare request_id bigint; secret text; config_row public.pa_cloud_worker_config%rowtype;
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
 select * into config_row from public.pa_cloud_worker_config where singleton;
 if config_row.function_url is null or config_row.function_url !~ '^https://[^[:space:]?#]+/functions/v1/prospectai-worker$' then
   raise exception 'Cloud worker function URL is not configured';
 end if;
 select decrypted_secret into secret from vault.decrypted_secrets where name = config_row.token_secret_name;
 if secret is null then raise exception 'Cloud scheduler token is not configured'; end if;
 select net.http_post(
   url := config_row.function_url,
   headers := jsonb_build_object('Content-Type','application/json','x-worker-token',secret),
   body := '{}'::jsonb, timeout_milliseconds := 100000
 ) into request_id;
 return request_id;
end;
$$;
revoke all on function public.pa_cloud_tick() from public,anon,authenticated;
grant execute on function public.pa_cloud_tick() to service_role;
