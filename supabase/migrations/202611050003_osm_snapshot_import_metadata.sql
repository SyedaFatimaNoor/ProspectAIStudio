-- Snapshot imports originate from a locally downloaded OSM extract. Keep the
-- import state and provenance in the database so a partial/empty load can never
-- look like a worker-ready source.

-- OSM numeric IDs overlap between element types. Source identity is the typed
-- element ID (for example node/123 and way/123), not the numeric part alone.
alter table public.pa_osm_businesses
  drop constraint pa_osm_businesses_pkey;
alter table public.pa_osm_businesses
  add constraint pa_osm_businesses_osm_type_id_key unique (osm_type_id);

create table public.pa_osm_snapshot_import_state (
  singleton boolean primary key default true check (singleton),
  status text not null default 'empty'
    check (status in ('empty', 'loading', 'ready', 'failed')),
  source_name text,
  source_url text,
  attribution text,
  dataset_timestamp timestamptz,
  last_successful_import_at timestamptz,
  places_imported integer not null default 0 check (places_imported >= 0),
  businesses_imported integer not null default 0 check (businesses_imported >= 0),
  last_error text,
  updated_at timestamptz not null default now()
);
alter table public.pa_osm_snapshot_import_state enable row level security;
revoke all on public.pa_osm_snapshot_import_state from anon, authenticated;
grant all on public.pa_osm_snapshot_import_state to service_role;
insert into public.pa_osm_snapshot_import_state(singleton) values (true)
on conflict (singleton) do nothing;

create or replace function public.pa_osm_snapshot_begin_import(
  p_source_name text,
  p_source_url text,
  p_attribution text,
  p_dataset_timestamp timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(length(btrim(p_source_name)), 0) = 0 or length(p_source_name) > 160 then
    raise exception 'A bounded snapshot source name is required';
  end if;
  if p_source_url !~ '^https://[^[:space:]?#]+$' or length(p_source_url) > 1000 then
    raise exception 'A credential-free HTTPS snapshot source URL is required';
  end if;
  if coalesce(length(btrim(p_attribution)), 0) = 0 or length(p_attribution) > 500 then
    raise exception 'Snapshot attribution is required';
  end if;

  update public.pa_osm_snapshot_import_state
     set status = 'loading',
         source_name = btrim(p_source_name),
         source_url = p_source_url,
         attribution = btrim(p_attribution),
         dataset_timestamp = p_dataset_timestamp,
         last_error = null,
         updated_at = now()
   where singleton;
end;
$$;
revoke all on function public.pa_osm_snapshot_begin_import(text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.pa_osm_snapshot_begin_import(text,text,text,timestamptz)
  to service_role;

create or replace function public.pa_osm_snapshot_complete_import(
  p_places_imported integer,
  p_businesses_imported integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_places_imported <= 0 or p_businesses_imported <= 0 then
    raise exception 'An OSM snapshot must contain at least one place and one business';
  end if;

  update public.pa_osm_snapshot_import_state
     set status = 'ready',
         last_successful_import_at = now(),
         places_imported = p_places_imported,
         businesses_imported = p_businesses_imported,
         last_error = null,
         updated_at = now()
   where singleton and status = 'loading';

  if not found then
    raise exception 'No active OSM snapshot import can be completed';
  end if;
end;
$$;
revoke all on function public.pa_osm_snapshot_complete_import(integer,integer)
  from public, anon, authenticated;
grant execute on function public.pa_osm_snapshot_complete_import(integer,integer)
  to service_role;

create or replace function public.pa_osm_snapshot_fail_import(p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pa_osm_snapshot_import_state
     set status = 'failed',
         last_error = left(coalesce(nullif(btrim(p_error), ''), 'Snapshot import failed.'), 500),
         updated_at = now()
   where singleton and status = 'loading';
end;
$$;
revoke all on function public.pa_osm_snapshot_fail_import(text)
  from public, anon, authenticated;
grant execute on function public.pa_osm_snapshot_fail_import(text)
  to service_role;

-- Retain the service-only chunked loader, but upsert against the full OSM
-- identity so same-number node/way/relation elements remain distinct.
create or replace function public.pa_osm_load_businesses(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
 if coalesce(jsonb_array_length(p_rows),0) > 50000 then raise exception 'Snapshot chunk too large'; end if;
 create temporary table if not exists _snap_biz (like public.pa_osm_businesses including defaults) on commit drop;
 truncate _snap_biz;
 insert into _snap_biz
   select (r->>'id')::bigint, r->>'kind', r->>'osm_type_id', left(r->>'category_key',40),
          left(r->>'category_value',60), left(r->>'app_category',40), left(r->>'name',200),
          left(r->>'phone',100), left(r->>'email',200), left(r->>'website',300),
          left(r->>'street',200), left(r->>'housenumber',40), left(r->>'locality',120),
          left(r->>'country_code',8),
          (r->>'lat')::double precision, (r->>'lon')::double precision,
          coalesce((select array_agg(x::bigint) from jsonb_array_elements_text(r->'place_ids') x), '{}')::bigint[],
          case when r->>'edit_at' ~ '^[0-9]+$' then to_timestamp((r->>'edit_at')::bigint) end,
          coalesce((r->>'snapshot_date')::date, current_date)
   from jsonb_array_elements(p_rows) r;
 insert into public.pa_osm_businesses select * from _snap_biz
 on conflict (osm_type_id) do update set kind = excluded.kind, id = excluded.id,
   category_key = excluded.category_key, category_value = excluded.category_value,
   app_category = excluded.app_category, name = excluded.name, phone = excluded.phone,
   email = excluded.email, website = excluded.website, street = excluded.street,
   housenumber = excluded.housenumber, locality = excluded.locality,
   country_code = excluded.country_code, lat = excluded.lat,
   lon = excluded.lon, place_ids = excluded.place_ids, edit_at = excluded.edit_at,
   snapshot_date = excluded.snapshot_date;
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.pa_osm_load_businesses(jsonb) from public, anon, authenticated;
grant execute on function public.pa_osm_load_businesses(jsonb) to service_role;

-- Aggregate operational metadata only. It deliberately exposes no listing or
-- contact data, and makes loading/failed snapshots unavailable to discovery.
create or replace function public.pa_osm_snapshot_status() returns jsonb
language sql stable security definer set search_path = public as $$
 select jsonb_build_object(
   'businesses', (select count(*) from public.pa_osm_businesses),
   'places', (select count(*) from public.pa_osm_places),
   'oldest_snapshot', (select min(snapshot_date) from public.pa_osm_businesses),
   'newest_snapshot', (select max(snapshot_date) from public.pa_osm_businesses),
   'import_status', s.status,
   'source_name', s.source_name,
   'source_url', s.source_url,
   'attribution', s.attribution,
   'dataset_timestamp', s.dataset_timestamp,
   'last_successful_import_at', s.last_successful_import_at,
   'places_imported', s.places_imported,
   'businesses_imported', s.businesses_imported,
   'last_import_error', s.last_error)
 from public.pa_osm_snapshot_import_state s
 where s.singleton;
$$;
revoke all on function public.pa_osm_snapshot_status() from public, anon;
grant execute on function public.pa_osm_snapshot_status() to authenticated, service_role;
