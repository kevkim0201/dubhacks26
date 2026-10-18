-- Log the full checkout conversation alongside the cart snapshot.
-- Apply in the Supabase SQL Editor after schema.sql and earlier migrations.

alter table public.checkout_sessions
  add column if not exists page_url text,
  add column if not exists transcript jsonb not null default '[]'::jsonb,
  add column if not exists duration_seconds integer check (duration_seconds >= 0),
  add column if not exists conversation_ended_at timestamptz;

alter table public.checkout_sessions
  drop constraint if exists checkout_sessions_transcript_is_array;
alter table public.checkout_sessions
  add constraint checkout_sessions_transcript_is_array
  check (jsonb_typeof(transcript) = 'array');
