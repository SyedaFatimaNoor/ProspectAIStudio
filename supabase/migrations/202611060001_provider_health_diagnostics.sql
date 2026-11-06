-- Extend authenticated provider-health observations with bounded diagnostic
-- metadata. Existing rows are not rewritten; legacy statuses remain accepted so
-- old observations stay readable until an operator runs a new check.
alter table public.pa_provider_health
  add column if not exists provider_configured boolean not null default false,
  add column if not exists provider_hostname text,
  add column if not exists requested_at timestamptz,
  add column if not exists response_time_ms integer
    check (response_time_ms is null or response_time_ms >= 0),
  add column if not exists http_status integer
    check (http_status is null or (http_status between 100 and 599)),
  add column if not exists response_valid boolean,
  add column if not exists last_failed_at timestamptz;

alter table public.pa_provider_health
  drop constraint if exists pa_provider_health_status_check;

alter table public.pa_provider_health
  add constraint pa_provider_health_status_check
  check (status in (
    -- Required operator-facing states.
    'not_configured',
    'checking',
    'reachable',
    'blocked',
    'rate_limited',
    'timeout',
    'invalid_response',
    'unavailable',
    -- Legacy persisted values retained for backwards compatibility.
    'paused',
    'not_applicable',
    'unreachable'
  ));
