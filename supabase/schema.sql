-- Squirrel Savings MVP schema for Supabase.
-- Apply once in the Supabase SQL Editor. Client apps should read through the
-- backend; the service-role key must never be shipped in the extension.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'Pip',
  total_xp bigint not null default 0 check (total_xp >= 0),
  acorn_balance bigint not null default 0 check (acorn_balance >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  tier text generated always as (
    case
      when total_xp >= 7500 then 'Golden'
      when total_xp >= 3000 then 'Hoarder'
      when total_xp >= 1000 then 'Forager'
      when total_xp >= 250 then 'Scout'
      else 'Baby'
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  store text not null,
  cart_total numeric(10, 2) not null default 0 check (cart_total >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  assessment text check (assessment in ('clear_need', 'unsure', 'impulsive')),
  suggestion text check (suggestion in ('buy', 'wait', 'skip')),
  reason_summary text,
  closing_line text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid unique references public.checkout_sessions (id) on delete set null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  store text not null,
  cart_total numeric(10, 2) not null default 0 check (cart_total >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  decision text not null check (decision in ('buy', 'save', 'skip')),
  base_acorns integer not null default 0 check (base_acorns >= 0),
  streak_bonus_acorns integer not null default 0 check (streak_bonus_acorns >= 0),
  delayed_bonus_acorns integer not null default 0 check (delayed_bonus_acorns >= 0),
  total_acorns integer not null default 0 check (total_acorns >= 0),
  status text not null check (status in ('pending', 'locked', 'cancelled')),
  reason_summary text,
  available_at timestamptz,
  locked_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'pending' or available_at is not null),
  check (status <> 'locked' or locked_at is not null),
  check (status <> 'cancelled' or cancelled_at is not null)
);

create table public.saved_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source_decision_id uuid not null references public.decisions (id) on delete cascade,
  item_key text not null,
  item_name text not null,
  item_url text,
  item_price numeric(10, 2) not null default 0 check (item_price >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'waiting' check (status in ('waiting', 'bought', 'dropped')),
  saved_at timestamptz not null default now(),
  bonus_eligible_at timestamptz not null,
  purchase_detected_at timestamptz,
  bonus_awarded_at timestamptz,
  bonus_acorns integer not null default 20 check (bonus_acorns >= 0),
  created_at timestamptz not null default now(),
  unique (source_decision_id, item_key)
);

create table public.cosmetics (
  id text primary key,
  name text not null,
  description text,
  category text not null,
  cost_acorns integer not null default 0 check (cost_acorns >= 0),
  minimum_tier text not null default 'Baby'
    check (minimum_tier in ('Baby', 'Scout', 'Forager', 'Hoarder', 'Golden')),
  asset_key text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.user_cosmetics (
  user_id uuid not null references public.profiles (id) on delete cascade,
  cosmetic_id text not null references public.cosmetics (id) on delete cascade,
  is_equipped boolean not null default false,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, cosmetic_id)
);

create index checkout_sessions_user_created_idx
  on public.checkout_sessions (user_id, created_at desc);
create index decisions_user_created_idx
  on public.decisions (user_id, created_at desc);
create index decisions_pending_available_idx
  on public.decisions (available_at)
  where status = 'pending';
create index decisions_locked_user_created_idx
  on public.decisions (user_id, created_at desc)
  where status = 'locked';
create index saved_items_user_status_idx
  on public.saved_items (user_id, status, bonus_eligible_at);
create index user_cosmetics_user_idx
  on public.user_cosmetics (user_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger checkout_sessions_set_updated_at
before update on public.checkout_sessions
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'username', ''), 'Pip')
  );
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.checkout_sessions enable row level security;
alter table public.decisions enable row level security;
alter table public.saved_items enable row level security;
alter table public.cosmetics enable row level security;
alter table public.user_cosmetics enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users can read their own checkout sessions"
  on public.checkout_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own decisions"
  on public.decisions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their own saved items"
  on public.saved_items for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Anyone can read active cosmetics"
  on public.cosmetics for select to authenticated
  using (is_active);

create policy "Users can read their own cosmetic unlocks"
  on public.user_cosmetics for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.profiles to authenticated;
grant select on public.checkout_sessions to authenticated;
grant select on public.decisions to authenticated;
grant select on public.saved_items to authenticated;
grant select on public.cosmetics to authenticated;
grant select on public.user_cosmetics to authenticated;

grant all on public.profiles to service_role;
grant all on public.checkout_sessions to service_role;
grant all on public.decisions to service_role;
grant all on public.saved_items to service_role;
grant all on public.cosmetics to service_role;
grant all on public.user_cosmetics to service_role;
