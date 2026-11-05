-- Possible duplicates are review work, not an instruction to delete or merge.
create table public.pa_duplicate_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'manual_review' check (status in ('manual_review','resolved_separate','confirmed_duplicate')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text not null default ''
);
alter table public.pa_duplicate_groups enable row level security;
create policy own_duplicate_groups on public.pa_duplicate_groups for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create index pa_duplicate_groups_user_status on public.pa_duplicate_groups(user_id,status,created_at desc);

alter table public.pa_businesses
  drop constraint if exists pa_businesses_user_id_provider_source_id_key,
  drop constraint if exists pa_businesses_user_id_fingerprint_key,
  add column if not exists duplicate_group_id uuid references public.pa_duplicate_groups(id) on delete set null,
  add column if not exists duplicate_match_reason text,
  add column if not exists duplicate_review_status text not null default 'not_duplicate'
    check (duplicate_review_status in ('not_duplicate','manual_review','resolved_separate','confirmed_duplicate'));
create index if not exists pa_businesses_duplicate_group_idx on public.pa_businesses(user_id,duplicate_group_id);

-- Sources stay attached to every original business record; no source row is moved or discarded.
