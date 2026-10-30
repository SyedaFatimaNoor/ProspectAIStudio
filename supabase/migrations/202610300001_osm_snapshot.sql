-- Free snapshot source for discovery. OpenStreetMap data is an open database
-- (ODbL), so a bounded country snapshot may be stored and re-served with
-- attribution. This path makes no outbound provider request, so it works on
-- serverless hosting where a 150MB .osm.pbf file and Overpass egress do not.
create table public.pa_osm_places (
 id bigint primary key,
 kind text not null check(kind in ('node','way','relation')),
 name text not null,
 name_en text,
 place text not null,
 country_code text not null,
 lat double precision not null,
 lon double precision not null,
 rank smallint not null default 0
);
create table public.pa_osm_businesses (
 id bigint primary key,
 kind text not null check(kind in ('node','way','relation')),
 osm_type_id text not null,
 category_key text not null,
 category_value text not null,
 app_category text not null,
 name text not null,
 phone text,
 email text,
 website text,
 street text,
 housenumber text,
 locality text,
 country_code text not null,
 lat double precision not null,
 lon double precision not null,
 place_ids bigint[] not null default '{}',
 edit_at timestamptz,
 snapshot_date date not null default current_date
);
create index pa_osm_businesses_place_idx on public.pa_osm_businesses using gin (place_ids);
create index pa_osm_businesses_category_idx on public.pa_osm_businesses (app_category);
create index pa_osm_businesses_name_idx on public.pa_osm_businesses (lower(name));
create index pa_osm_places_name_idx on public.pa_osm_places (lower(name));

alter table public.pa_osm_places enable row level security;
alter table public.pa_osm_businesses enable row level security;
revoke all on public.pa_osm_places, public.pa_osm_businesses from anon, authenticated;
grant all on public.pa_osm_places, public.pa_osm_businesses to service_role;

-- Loaded only by a worker with a locally readable country extract. Credentials
-- never leave the machine that produced the rows.
create or replace function public.pa_osm_load_places(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
 if coalesce(jsonb_array_length(p_rows),0) > 50000 then raise exception 'Snapshot chunk too large'; end if;
 create temporary table if not exists _snap_places (like public.pa_osm_places including defaults) on commit drop;
 truncate _snap_places;
 insert into _snap_places
   select (r->>'id')::bigint, r->>'kind', left(r->>'name',200), left(r->>'name_en',200),
          left(r->>'place',40), left(r->>'country_code',8),
          (r->>'lat')::double precision, (r->>'lon')::double precision,
          coalesce((r->>'rank')::smallint,0)
   from jsonb_array_elements(p_rows) r;
 insert into public.pa_osm_places select * from _snap_places
 on conflict (id) do update set name = excluded.name, name_en = excluded.name_en,
   place = excluded.place, country_code = excluded.country_code,
   lat = excluded.lat, lon = excluded.lon, rank = excluded.rank;
 get diagnostics n = row_count;
 return n;
end $$;
revoke all on function public.pa_osm_load_places(jsonb) from public, anon, authenticated;
grant execute on function public.pa_osm_load_places(jsonb) to service_role;

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
 on conflict (id) do update set kind = excluded.kind, osm_type_id = excluded.osm_type_id,
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

-- Haversine without requiring PostGIS, which the free tier does not always
-- allow to be enabled by a migration alone.
create or replace function public.pa_osm_distance(
 lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
 select 2 * 6371 * asin(sqrt(
   power(sin(radians((lat2 - lat1) / 2)), 2) +
   cos(radians(lat1)) * cos(radians(lat2)) *
   power(sin(radians((lon2 - lon1) / 2)), 2)))
$$;
revoke all on function public.pa_osm_distance(double precision,double precision,double precision,double precision) from public;
grant execute on function public.pa_osm_distance(double precision,double precision,double precision,double precision) to public;

create or replace function public.pa_osm_place_scope(p_city_id bigint)
returns table (ids bigint[])
language sql stable security definer set search_path = public as $$
 select array(
   select p.id from public.pa_osm_places p
   where p.id = p_city_id
      or (p.rank < (select c.rank from public.pa_osm_places c where c.id = p_city_id)
          and public.pa_osm_distance(
              (select c.lat from public.pa_osm_places c where c.id = p_city_id),
              (select c.lon from public.pa_osm_places c where c.id = p_city_id),
              p.lat, p.lon) < case (select c.rank from public.pa_osm_places c where c.id = p_city_id)
                                when 4 then 45 when 3 then 25 else 12 end)
 )::bigint[]
$$;
revoke all on function public.pa_osm_place_scope(bigint) from public, anon;
grant execute on function public.pa_osm_place_scope(bigint) to service_role;

-- Search is scoped to one city: the place node resolves to the place rows that
-- carry it and its children, so a nationwide listing cannot leak into a city.
create or replace function public.pa_osm_search(
 p_country text, p_city text, p_category text, p_limit int default 100)
returns table (
 id bigint, osm_type_id text, name text, phone text, email text, website text,
 street text, housenumber text, locality text, lat double precision,
 lon double precision, edit_at timestamptz, snapshot_date date, distance_km numeric)
language sql stable security definer set search_path = public as $$
 select b.id, b.osm_type_id, b.name, b.phone, b.email, b.website, b.street,
        b.housenumber, b.locality, b.lat, b.lon, b.edit_at, b.snapshot_date,
        round(public.pa_osm_distance(c.lat,c.lon,b.lat,b.lon)::numeric,2) as distance_km
 from (select c.lat, c.lon, c.id
       from public.pa_osm_places c
       where lower(c.country_code) = lower(p_country)
         and c.rank >= 2
         and (lower(c.name) = lower(p_city) or lower(coalesce(c.name_en,'')) = lower(p_city))
       order by c.rank desc limit 1) c
 join lateral public.pa_osm_place_scope(c.id) s on true
 join public.pa_osm_businesses b
   on b.app_category = p_category and b.place_ids && s.ids
   and lower(b.country_code) = lower(p_country)
 order by distance_km asc, b.id
 limit least(greatest(p_limit,1),100)
$$;
revoke all on function public.pa_osm_search(text,text,text,int) from public, anon;
grant execute on function public.pa_osm_search(text,text,text,int) to authenticated, service_role;

-- Reported to the operator UI so a snapshot can never look like live data.
create or replace function public.pa_osm_snapshot_status() returns jsonb
language sql stable security definer set search_path = public as $$
 select jsonb_build_object(
   'businesses', (select count(*) from public.pa_osm_businesses),
   'places', (select count(*) from public.pa_osm_places),
   'oldest_snapshot', (select min(snapshot_date) from public.pa_osm_businesses),
   'newest_snapshot', (select max(snapshot_date) from public.pa_osm_businesses))
$$;
revoke all on function public.pa_osm_snapshot_status() from public, anon;
grant execute on function public.pa_osm_snapshot_status() to authenticated, service_role;
