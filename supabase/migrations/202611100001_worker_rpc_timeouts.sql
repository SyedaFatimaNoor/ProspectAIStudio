-- Keep database-side work bounded below the two-minute cloud-worker lease.
-- The Edge worker also has a hard transport timeout; these settings protect
-- the database transaction if an RPC is blocked on a lock or slow query.
alter function public.pa_osm_search(text, text, text, integer)
  set statement_timeout = '15s';

alter function public.pa_cloud_commit(uuid, uuid, jsonb, integer)
  set statement_timeout = '15s';

alter function public.pa_cloud_fail(uuid, uuid, text, text, integer, text)
  set statement_timeout = '10s';
