-- Deal checks: Pip hunting for a better price after a checkout conversation.
--   trigger = 'buy'  -> the user asked right away ("look for a better deal before I pay")
--   trigger = 'wait' -> scheduled 24 hours after the user chose to wait; runs the first time the
--                       dashboard is opened after due_at, so prices are fresh when they decide.
-- Apply in the Supabase SQL Editor after the earlier 20261018 migrations. Safe to re-run.

create table if not exists public.deal_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid references public.checkout_sessions (id) on delete set null,
  trigger text not null check (trigger in ('buy', 'wait')),
  item_name text not null,
  item_price numeric(10, 2) not null check (item_price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  store text,
  page_url text,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  due_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  seen_at timestamptz,
  result jsonb,          -- the deal agent's DealResponse
  error text,
  created_at timestamptz not null default now()
);

create index if not exists deal_checks_user_due_idx on public.deal_checks (user_id, status, due_at);
-- One check per item per trigger; lets the API skip duplicates (NULL session ids never collide).
drop index if exists public.deal_checks_session_item_idx;
create unique index if not exists deal_checks_session_item_idx
  on public.deal_checks (session_id, trigger, item_name);

alter table public.deal_checks enable row level security;

drop policy if exists "Users can read their own deal checks" on public.deal_checks;
create policy "Users can read their own deal checks"
  on public.deal_checks for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.deal_checks to authenticated;
grant all on public.deal_checks to service_role;

notify pgrst, 'reload schema';
