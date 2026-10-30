-- Transactional regression for the OpenStreetMap snapshot source. Fixtures only;
-- ROLLBACK leaves the loaded snapshot and every user row untouched.
begin;
do $$
declare n int; hits jsonb; first text; city_id bigint;
begin
 n := public.pa_osm_load_places('[
   {"id":900001,"kind":"node","name":"QA Test Karachi","name_en":null,"place":"city","country_code":"QA-Test-Land","lat":24.86,"lon":67.01,"rank":4},
   {"id":900002,"kind":"node","name":"QA Test Clifton","name_en":null,"place":"suburb","country_code":"QA-Test-Land","lat":24.81,"lon":67.03,"rank":2},
   {"id":900003,"kind":"node","name":"QA Test Other City","name_en":null,"place":"city","country_code":"QA-Test-Land","lat":31.52,"lon":74.35,"rank":4}
 ]'::jsonb);
 if n <> 3 then raise exception 'Snapshot places load reported %', n; end if;

 select id into city_id from public.pa_osm_places where name = 'QA Test Karachi';
 if city_id is null then raise exception 'Snapshot place was not stored'; end if;

 n := public.pa_osm_load_businesses('[
   {"id":910001,"kind":"node","osm_type_id":"node/910001","category_key":"amenity","category_value":"cafe","app_category":"cafe","name":"QA Test Cafe Near","phone":"+92 300 0000000","email":null,"website":"cafe.example","street":"Test Street","housenumber":"1","locality":"QA Test Karachi","country_code":"QA-Test-Land","lat":24.87,"lon":67.02,"place_ids":[900001,900002],"edit_at":"1761800000","snapshot_date":"2026-10-30"},
   {"id":910002,"kind":"way","osm_type_id":"way/910002","category_key":"amenity","category_value":"cafe","app_category":"cafe","name":"QA Test Cafe Far","phone":null,"email":null,"website":null,"street":null,"housenumber":null,"locality":"QA Test Other City","country_code":"QA-Test-Land","lat":31.55,"lon":74.33,"place_ids":[900003],"edit_at":null,"snapshot_date":"2026-10-30"},
   {"id":910003,"kind":"node","osm_type_id":"node/910003","category_key":"amenity","category_value":"cafe","app_category":"cafe","name":"QA Test Restaurant Wrong Category","phone":null,"email":null,"website":null,"street":null,"housenumber":null,"locality":"QA Test Karachi","country_code":"QA-Test-Land","lat":24.88,"lon":67.01,"place_ids":[900001],"snapshot_date":"2026-10-30"}
 ]'::jsonb);
 if n <> 3 then raise exception 'Snapshot listings load reported %', n; end if;
 -- id 910003 carries the restaurant name but the cafe category on purpose: the
 -- search key is app_category, so all three city matches must be reachable.

 select jsonb_agg(name order by name) into hits
 from public.pa_osm_search('QA-Test-Land', 'QA Test Karachi', 'cafe', 100);
 if hits is null or jsonb_array_length(hits) <> 2 then
   raise exception 'City scoping leaked: %', coalesce(hits::text, 'nothing');
 end if;
 if hits @> '["QA Test Cafe Far"]'::jsonb then
   raise exception 'A listing from another city was returned';
 end if;

 -- Nearest listing first, and the distance is the snapshot column, not a guess.
 select name into first from public.pa_osm_search('QA-Test-Land','QA Test Karachi','cafe',1);
 if first <> 'QA Test Cafe Near' then raise exception 'Ordering broke: %', first; end if;
 if (select distance_km from public.pa_osm_search('QA-Test-Land','QA Test Karachi','cafe',1)) >= 100 then
   raise exception 'Distance is not scoped to the city';
 end if;

 -- The limit is honoured and clamped to the product maximum.
 if (select count(*) from public.pa_osm_search('QA-Test-Land','QA Test Karachi','cafe',1)) <> 1 then
   raise exception 'Snapshot limit ignored';
 end if;
 if (select count(*) from public.pa_osm_search('QA-Test-Land','QA Test Karachi','cafe',500)) <> 2 then
   raise exception 'Snapshot limit was not clamped to the product maximum';
 end if;

 -- An unknown city returns no rows, which the source adapter reports as a failure.
 if (select count(*) from public.pa_osm_search('QA-Test-Land','QA Test Nowhere','cafe',100)) <> 0 then
   raise exception 'Unknown city matched something';
 end if;

 -- Loading is service-role only; the search is usable by a signed-in workspace.
 if has_function_privilege('anon','public.pa_osm_load_places(jsonb)','EXECUTE')
    or has_function_privilege('authenticated','public.pa_osm_load_businesses(jsonb)','EXECUTE') then
   raise exception 'Snapshot loading is not service-role only';
 end if;
 if not has_function_privilege('authenticated','public.pa_osm_search(text,text,text,int)','EXECUTE') then
   raise exception 'A signed-in workspace cannot search the snapshot';
 end if;
 if has_table_privilege('authenticated','public.pa_osm_businesses','SELECT') then
   raise exception 'Raw snapshot tables are readable without the RPC';
 end if;
 if (select count(*) from pg_policy where polrelid = 'public.pa_osm_businesses'::regclass) <> 0 then
   raise exception 'Snapshot tables carry row policies they do not need';
 end if;

 if public.pa_osm_snapshot_status() ->> 'businesses' is null then
   raise exception 'Snapshot status is unusable';
 end if;
end $$;
select 'PASS: snapshot scopes searches to one city, clamps limits, and keeps loading service-only' as result;
rollback;
