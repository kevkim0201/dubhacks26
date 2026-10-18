-- What kind of purchase each checkout was, plus the main item Pip discussed.
-- Apply in the Supabase SQL Editor after 20261018_conversation_logging.sql. Safe to re-run.

alter table public.checkout_sessions
  add column if not exists category text,
  add column if not exists item_name text;

alter table public.decisions
  add column if not exists category text,
  add column if not exists item_name text;

-- Make the REST API see the new columns immediately.
notify pgrst, 'reload schema';
