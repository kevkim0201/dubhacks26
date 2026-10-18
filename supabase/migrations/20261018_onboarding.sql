-- Onboarding interview with Pip: what the user shared about their spending.
-- personalization: answers as JSON (see backend/app/routers/onboarding.py for the shape).
-- onboarding_completed_at: set when the user finishes OR skips; null = show the interview.
-- Apply in the Supabase SQL Editor after schema.sql. Safe to re-run.

alter table public.profiles
  add column if not exists personalization jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_completed_at timestamptz;

alter table public.profiles drop constraint if exists profiles_personalization_is_object;
alter table public.profiles
  add constraint profiles_personalization_is_object check (jsonb_typeof(personalization) = 'object');

notify pgrst, 'reload schema';
