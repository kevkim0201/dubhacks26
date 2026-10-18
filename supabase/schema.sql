-- Squirrel Savings MVP schema for Supabase.
-- Apply once in the Supabase SQL Editor. Client apps should read through the
-- backend; the service-role key must never be shipped in the extension.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null default 'Pip',
  total_xp bigint not null default 0 check (total_xp >= 0),
  acorn_balance bigint not null default 0 check (acorn_balance >= 0),
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
  page_url text,
  transcript jsonb not null default '[]'::jsonb
    constraint checkout_sessions_transcript_is_array check (jsonb_typeof(transcript) = 'array'),
  duration_seconds integer check (duration_seconds >= 0),
  conversation_ended_at timestamptz,
  category text check (category in ('electronics', 'clothing', 'shoes', 'beauty', 'home', 'kitchen', 'food',
      'health', 'sports', 'outdoors', 'toys', 'books', 'entertainment', 'travel',
      'office', 'pets', 'jewelry', 'automotive', 'other')),
  item_name text,
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
  recommended_decision text not null check (recommended_decision in ('buy', 'save', 'skip')),
  recommendation_matched boolean not null,
  requested_acorns integer not null default 0 check (requested_acorns >= 0),
  engagement_acorns integer not null default 0 check (engagement_acorns >= 0),
  decision_bonus_acorns integer not null default 0 check (decision_bonus_acorns >= 0),
  total_acorns integer not null default 0 check (total_acorns >= 0),
  xp_awarded bigint not null default 0 check (xp_awarded >= 0),
  daily_cap_applied boolean not null default false,
  legacy_reward_breakdown jsonb,
  reason_summary text,
  category text check (category in ('electronics', 'clothing', 'shoes', 'beauty', 'home', 'kitchen', 'food',
      'health', 'sports', 'outdoors', 'toys', 'books', 'entertainment', 'travel',
      'office', 'pets', 'jewelry', 'automotive', 'other')),
  item_name text,
  created_at timestamptz not null default now(),
  check (total_acorns = engagement_acorns + decision_bonus_acorns),
  check (xp_awarded = total_acorns)
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
  purchase_detected_at timestamptz,
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
create index saved_items_user_status_idx
  on public.saved_items (user_id, status, saved_at desc);
create index user_cosmetics_user_idx
  on public.user_cosmetics (user_id);

create function public.record_checkout_decision(
  p_user_id uuid,
  p_session_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.checkout_sessions%rowtype;
  v_old_tier text;
  v_new_tier text;
  v_recommended_decision text;
  v_recommendation_matched boolean;
  v_requested_engagement integer := 0;
  v_requested_bonus integer := 0;
  v_requested_total integer := 0;
  v_daily_acorns bigint;
  v_remaining_cap integer;
  v_engagement_acorns integer := 0;
  v_decision_bonus_acorns integer := 0;
  v_total_acorns integer := 0;
  v_new_total_xp bigint;
  v_new_acorn_balance bigint;
  v_tier_up boolean;
  v_utc_day_start timestamptz :=
    date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_decision is null or p_decision not in ('buy', 'save', 'skip') then
    raise exception 'Decision must be buy, save, or skip'
      using errcode = '22023';
  end if;

  select tier
  into v_old_tier
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  select *
  into v_session
  from public.checkout_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Checkout session not found' using errcode = 'P0002';
  end if;

  if v_session.status <> 'active'
      or v_session.assessment is null
      or v_session.suggestion is null then
    raise exception 'Checkout conversation is not ready for a decision'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.decisions
    where session_id = p_session_id
  ) then
    raise exception 'A decision has already been recorded for this session'
      using errcode = '23505';
  end if;

  v_recommended_decision := case v_session.suggestion
    when 'wait' then 'save'
    else v_session.suggestion
  end;
  v_recommendation_matched := v_recommended_decision = p_decision;

  if p_decision = 'buy' and v_recommendation_matched then
    v_requested_engagement := 5;
    v_requested_bonus := 10;
  elsif p_decision = 'save' then
    v_requested_engagement := 5;
    v_requested_bonus := 5;
  elsif p_decision = 'skip' then
    v_requested_engagement := 5;
    if v_recommendation_matched then
      v_requested_bonus := 25;
    end if;
  end if;

  v_requested_total := v_requested_engagement + v_requested_bonus;

  select coalesce(sum(total_acorns), 0)
  into v_daily_acorns
  from public.decisions
  where user_id = p_user_id
    and created_at >= v_utc_day_start
    and created_at < v_utc_day_start + interval '1 day';

  v_remaining_cap := greatest(200 - v_daily_acorns, 0);
  v_engagement_acorns := least(v_requested_engagement, v_remaining_cap);
  v_decision_bonus_acorns := least(
    v_requested_bonus,
    v_remaining_cap - v_engagement_acorns
  );
  v_total_acorns := v_engagement_acorns + v_decision_bonus_acorns;

  update public.profiles
  set total_xp = total_xp + v_total_acorns,
      acorn_balance = acorn_balance + v_total_acorns
  where id = p_user_id
  returning total_xp, acorn_balance, tier
  into v_new_total_xp, v_new_acorn_balance, v_new_tier;

  insert into public.decisions (
    session_id,
    user_id,
    store,
    cart_total,
    currency,
    items,
    decision,
    recommended_decision,
    recommendation_matched,
    requested_acorns,
    engagement_acorns,
    decision_bonus_acorns,
    total_acorns,
    xp_awarded,
    daily_cap_applied,
    reason_summary
  ) values (
    p_session_id,
    p_user_id,
    v_session.store,
    v_session.cart_total,
    v_session.currency,
    v_session.items,
    p_decision,
    v_recommended_decision,
    v_recommendation_matched,
    v_requested_total,
    v_engagement_acorns,
    v_decision_bonus_acorns,
    v_total_acorns,
    v_total_acorns,
    v_total_acorns < v_requested_total,
    v_session.reason_summary
  );

  update public.checkout_sessions
  set status = 'completed',
      completed_at = now()
  where id = p_session_id;

  v_tier_up := v_new_tier <> v_old_tier;

  return jsonb_build_object(
    'decision', p_decision,
    'recommended_decision', v_recommended_decision,
    'recommendation_matched', v_recommendation_matched,
    'requested_acorns', v_requested_total,
    'acorns_awarded', v_total_acorns,
    'xp_awarded', v_total_acorns,
    'daily_cap_applied', v_total_acorns < v_requested_total,
    'total_xp', v_new_total_xp,
    'acorn_balance', v_new_acorn_balance,
    'tier', v_new_tier,
    'tier_up', v_tier_up,
    'daily_acorns_awarded', v_daily_acorns + v_total_acorns,
    'daily_acorn_cap', 200
  );
end;
$$;

revoke all on function public.record_checkout_decision(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_checkout_decision(uuid, uuid, text)
  to service_role;

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
