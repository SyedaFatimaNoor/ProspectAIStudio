-- An empty snapshot is not a discovery source. This service-only guard lets the
-- Edge worker fail closed before claiming a tenant job or contacting Overpass.
create or replace function public.pa_cloud_pause_source(p_error text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Do not clear an active token/lease: a concurrent worker may be finishing
  -- an already-claimed bounded job. Disabling prevents every later dispatch;
  -- the existing claim/commit guards still control the active invocation.
  update public.pa_cloud_worker
    set enabled = false,
        last_finished_at = case
          when token is null or lease_until is null or lease_until <= now() then now()
          else last_finished_at
        end,
        last_error = left(coalesce(nullif(trim(p_error), ''), 'Discovery source is not ready.'), 500)
    where singleton;
end;
$$;
revoke all on function public.pa_cloud_pause_source(text) from public, anon, authenticated;
grant execute on function public.pa_cloud_pause_source(text) to service_role;
