-- AI concepts are still ordinary tenant-owned proposals. These additive columns
-- preserve existing manual proposals and record provenance for generated ones.
alter table public.pa_proposals
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists generated_at timestamptz,
  add column if not exists ai_output jsonb,
  add column if not exists facts_snapshot jsonb;

-- NOT VALID deliberately preserves historical rows; all new/updated AI rows
-- must carry complete generation metadata. The application supplies these
-- server-side from the authenticated session, never from client input.
alter table public.pa_proposals
  drop constraint if exists pa_proposals_ai_metadata_check;
alter table public.pa_proposals
  add constraint pa_proposals_ai_metadata_check
  check (
    origin <> 'ai' or (
      ai_provider is not null and length(ai_provider) between 1 and 120
      and ai_model is not null and length(ai_model) between 1 and 120
      and generated_at is not null
      and ai_output is not null
      and facts_snapshot is not null
    )
  ) not valid;

-- Non-unique so existing deployments with more than one AI proposal can apply
-- this migration without deleting user data. Regeneration updates the server-
-- selected, owned AI proposal and increments its version.
create index if not exists pa_proposals_ai_concept_lookup
  on public.pa_proposals (user_id, business_id, origin, updated_at desc);

comment on column public.pa_proposals.ai_provider is 'Server-recorded AI provider name for an AI-origin concept.';
comment on column public.pa_proposals.ai_model is 'Server-recorded AI model name for an AI-origin concept.';
comment on column public.pa_proposals.generated_at is 'Server timestamp when the structured concept was generated.';
comment on column public.pa_proposals.ai_output is 'Validated structured AI concept output, never a raw unvalidated response.';
comment on column public.pa_proposals.facts_snapshot is 'Whitelisted verified lead facts and source provenance supplied to the provider.';
