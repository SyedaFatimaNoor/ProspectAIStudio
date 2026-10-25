create or replace function public.pa_purge_expired() returns integer language plpgsql security definer set search_path=public as $$
declare removed integer;
begin
 delete from public.pa_businesses b where b.created_at < now() - make_interval(days=>coalesce((select s.retention_days from public.pa_integration_settings s where s.user_id=b.user_id),90));
 get diagnostics removed = row_count;
 return removed;
end $$;
revoke all on function public.pa_purge_expired() from public,anon,authenticated;
grant execute on function public.pa_purge_expired() to service_role;
