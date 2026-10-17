-- Pocket -- initial Supabase schema.
-- Run this in the Supabase SQL editor (Project -> SQL Editor -> New query)
-- after creating the project. Starting point only -- extend freely.
--
-- Mirrors the shapes already used client-side in src/lib/purchases.js and
-- src/lib/character.js, plus a `coupons` table for the savings-maximization
-- feature (src/lib/coupons.js) -- that's the integration seam between the
-- two workstreams: Kevin/Deetya own this schema, Rohit/<you> query `coupons`
-- from the client once it's populated.

-- ---------------------------------------------------------------------------
-- profiles: one row per signed-in user. Supabase Auth creates auth.users
-- automatically; this table holds the app-specific bits (character identity,
-- theme colors -- see DEFAULT_SETTINGS in src/lib/storage.js).
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  character_name text not null default 'Pip',
  skin_color text not null default '#f3bd93',
  leaf_color text not null default '#2f6b4f',
  flower_color text not null default '#f472b6',
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles are self-readable" on profiles
  for select using (auth.uid() = id);

create policy "profiles are self-writable" on profiles
  for insert with check (auth.uid() = id);

create policy "profiles are self-updatable" on profiles
  for update using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- purchases: confirmed purchases, same shape as the local record in
-- src/lib/purchases.js (addPurchase). `source` distinguishes an
-- auto-detected purchase from a manually logged one.
-- ---------------------------------------------------------------------------
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  store text default '',
  url text default '',
  price_paid numeric(10, 2) not null default 0,
  savings numeric(10, 2) not null default 0,
  purchase_date timestamptz not null default now(),
  return_deadline timestamptz,
  returned boolean not null default false,
  returned_date timestamptz,
  source text not null default 'manual' check (source in ('manual', 'auto')),
  created_at timestamptz not null default now(),

  -- --- reward pipeline (see "Validating purchases for acorns" below) ---
  -- `coupon_id` is the client's *claim* that this coupon was used; it's
  -- just self-reported data at insert time. `status`/`acorns_awarded`/
  -- `validated_at` are never client-writable (see the column grants
  -- below) -- only validate_purchase() sets them, after re-checking the
  -- claim against coupon_validations rather than trusting it outright.
  coupon_id uuid references coupons (id),
  status text not null default 'pending_validation' check (status in ('pending_validation', 'validated', 'rejected')),
  acorns_awarded integer not null default 0,
  validated_at timestamptz
);

alter table purchases enable row level security;

-- Split what used to be one "for all" policy into one per command, so
-- update/delete can be scoped tighter than insert/select.
drop policy if exists "purchases are owner-writable" on purchases;

create policy "purchases are owner-readable" on purchases
  for select using (auth.uid() = user_id);

create policy "purchases are owner-insertable" on purchases
  for insert with check (auth.uid() = user_id);

-- Only the return-tracking fields are updatable by the owner; status/
-- acorns_awarded/validated_at/savings can't be touched this way even if
-- someone calls PostgREST directly -- see the column grants below.
create policy "purchases are owner-updatable" on purchases
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Only rows that never earned a reward can be deleted by their owner --
-- once a purchase is validated (and acorns are logged in acorn_ledger),
-- deleting it would hide the row without touching the ledger, so block
-- it instead of leaving a dangling "we don't know why you have these
-- acorns" entry.
create policy "purchases are owner-deletable if unvalidated" on purchases
  for delete using (auth.uid() = user_id and status <> 'validated');

-- Column-level privileges: these are enforced by Postgres itself (not
-- RLS), so a client calling PostgREST directly -- not just through
-- supabase.js -- physically cannot set status/acorns_awarded/
-- validated_at. Omitting a column from an INSERT/UPDATE is fine (the
-- column default applies); only *writing* to an ungranted column fails.
revoke insert, update on purchases from authenticated;
grant insert (title, store, url, price_paid, savings, purchase_date, return_deadline, source, coupon_id) on purchases to authenticated;
grant update (returned, returned_date) on purchases to authenticated;

create index if not exists purchases_user_id_idx on purchases (user_id);
create index if not exists purchases_return_deadline_idx on purchases (return_deadline) where returned = false;
create index if not exists purchases_status_idx on purchases (status) where status = 'pending_validation';

-- ---------------------------------------------------------------------------
-- coupons: community-sourced coupon codes. Readable by anyone (anon key),
-- so the extension can look up codes before a user is signed in at all.
-- Writes are left open to any authenticated user for now -- tighten this
-- (e.g. require a moderation flag) once the submission flow exists.
-- ---------------------------------------------------------------------------
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  store text not null,                 -- e.g. "target.com" -- match against location.hostname
  code text not null,
  description text default '',
  discount_type text check (discount_type in ('percent', 'fixed', 'shipping', 'unknown')) default 'unknown',
  discount_value numeric(10, 2),
  source_url text default '',
  submitted_by uuid references auth.users (id),
  success_count integer not null default 0,
  fail_count integer not null default 0,
  last_validated_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table coupons enable row level security;

create policy "coupons are publicly readable" on coupons
  for select using (true);

create policy "coupons are insertable by signed-in users" on coupons
  for insert with check (auth.uid() is not null);

create index if not exists coupons_store_idx on coupons (store);

-- ---------------------------------------------------------------------------
-- coupon_validations: a log of "I tried code X at store Y and it did/didn't
-- work," used to keep success_count/fail_count honest over time. Optional --
-- drop this if a simpler approach is preferred.
-- ---------------------------------------------------------------------------
create table if not exists coupon_validations (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references coupons (id) on delete cascade,
  user_id uuid references auth.users (id),
  worked boolean not null,
  cart_total numeric(10, 2),
  validated_at timestamptz not null default now()
);

alter table coupon_validations enable row level security;

create policy "coupon validations are publicly readable" on coupon_validations
  for select using (true);

-- Tightened from "any signed-in user" to "only as yourself" -- the new
-- validate_purchase() function below trusts this table to know *whose*
-- validation attempt a row is, so a mismatched or null user_id can't be
-- used to attribute a validation to someone else.
create policy "coupon validations are insertable by signed-in users" on coupon_validations
  for insert with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- acorn_ledger: append-only log of acorn grants (and, later, redemption
-- spends as negative deltas). A balance is sum(delta), not a mutable
-- counter column -- there's no row for a user to directly edit to bump
-- their own total, and every grant keeps a reason + the purchase that
-- earned it for free. Only validate_purchase() (security definer, below)
-- writes here; authenticated users get select only.
-- ---------------------------------------------------------------------------
create table if not exists acorn_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  purchase_id uuid references purchases (id) on delete set null,
  delta integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table acorn_ledger enable row level security;

create policy "acorn ledger is owner-readable" on acorn_ledger
  for select using (auth.uid() = user_id);

-- Deliberately no insert/update/delete policy for `authenticated` --
-- this table is only ever written by validate_purchase() / redeem_acorns()
-- below, which run as the function owner and bypass RLS.

create index if not exists acorn_ledger_user_id_idx on acorn_ledger (user_id);

-- ---------------------------------------------------------------------------
-- acorn_redemptions: stub for "spend acorns on X" (gift cards, donations,
-- in-game skins -- still an open product decision per the team). Request
-- rows are user-writable; redeem_acorns() below is what actually checks
-- the balance and posts the matching negative acorn_ledger entry, so this
-- table alone is never enough to grant a user more acorns.
-- ---------------------------------------------------------------------------
create table if not exists acorn_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  acorns_spent integer not null check (acorns_spent > 0),
  reward_type text not null default 'tbd',
  reward_detail text default '',
  status text not null default 'requested' check (status in ('requested', 'fulfilled', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table acorn_redemptions enable row level security;

create policy "acorn redemptions are owner-readable" on acorn_redemptions
  for select using (auth.uid() = user_id);

-- No insert policy here either -- rows are only created by redeem_acorns(),
-- which validates the balance first. Direct inserts would just be a
-- redemption *request* with no corresponding ledger debit, so they're
-- blocked rather than left to look real without one.

create index if not exists acorn_redemptions_user_id_idx on acorn_redemptions (user_id);

-- ---------------------------------------------------------------------------
-- Read-model views. `security_invoker = true` means they run with the
-- *caller's* privileges (and RLS), not the view owner's -- so a user
-- querying either view still only ever sees their own row, with zero
-- extra policies needed.
-- ---------------------------------------------------------------------------
create or replace view acorn_balances
  with (security_invoker = true) as
select user_id, coalesce(sum(delta), 0)::integer as balance
from acorn_ledger
group by user_id;

create or replace view character_stats
  with (security_invoker = true) as
select
  p.user_id,
  coalesce(sum(p.savings) filter (where p.status = 'validated'), 0)::numeric(10, 2) as total_saved,
  (coalesce(sum(p.savings) filter (where p.status = 'validated'), 0) * 10)::integer as xp,
  coalesce((select b.balance from acorn_balances b where b.user_id = p.user_id), 0) as acorn_balance
from purchases p
group by p.user_id;

-- ---------------------------------------------------------------------------
-- Validating purchases for acorns
--
-- The core problem: the extension runs entirely in the user's own
-- browser, using the user's own Supabase credentials. Nothing stops
-- someone from calling this REST API directly (bypassing the extension's
-- UI entirely) with a fabricated purchase. That means "did the client
-- say a purchase happened" can NEVER be trusted on its own -- the only
-- question worth asking is "what's the least-fakeable signal we can
-- check it against before paying out," not "how do we make it
-- unfakeable" (that would need a real signal from outside the browser,
-- e.g. a retailer webhook or affiliate-network postback, which is out of
-- scope here).
--
-- The signal this schema checks a reward claim against is Rohit's
-- coupon-validation pipeline: a purchase only earns anything -- XP *and*
-- acorns, both -- if it names a coupon_id AND this same user has a
-- coupon_validations row saying that coupon worked. No coupon attached
-- (a manual entry, or an auto-detected purchase the user never ran
-- through the coupon flow) is rejected outright: it was a product call
-- to only grow the character for purchases made *through Pocket*, not
-- for savings found/applied some other way. The claimed `savings` amount
-- on a coupon-backed purchase is capped against that coupon's own
-- recorded discount_type/discount_value (or, failing that, the
-- cart_total logged at validation time) rather than trusted outright.
--
-- This raises the bar from "edit one field in chrome.storage.local" to
-- "fabricate a coupon_validations row for a real coupon_id and attach it
-- to a fake purchase" -- good enough to keep a hackathon demo honest, not
-- a claim that it's fraud-proof. The honest remaining gap is that
-- `coupon_validations.worked` is itself self-reported; closing that
-- fully needs a signal the browser extension can't fabricate (e.g. the
-- retailer's own order confirmation via an affiliate network), which
-- isn't built here.
--
-- Flow from the client: insertInto('purchases', { ...claim, coupon_id })
-- (status defaults to 'pending_validation', acorns_awarded to 0 -- the
-- column grants above mean the client can't set either) immediately
-- followed by callRpc('validate_purchase', { p_purchase_id: id }).
-- ---------------------------------------------------------------------------
create or replace function validate_purchase(p_purchase_id uuid)
returns table (status text, acorns_awarded integer, total_saved numeric, xp integer, acorn_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase purchases;
  v_coupon coupons;
  v_validation coupon_validations;
  v_cap numeric;
  v_awarded_savings numeric;
  v_acorns integer;
begin
  -- Locks the row for the rest of this transaction, so a retried/
  -- double-fired request can't read 'pending_validation' twice and
  -- grant acorns twice before either commit.
  select * into v_purchase from purchases where id = p_purchase_id for update;

  if v_purchase is null then
    raise exception 'purchase not found';
  end if;

  if v_purchase.user_id <> auth.uid() then
    raise exception 'not your purchase';
  end if;

  -- Idempotent: calling this twice (e.g. a retried network request)
  -- just reports the already-decided outcome instead of re-granting or
  -- re-rejecting.
  if v_purchase.status <> 'pending_validation' then
    return query
      select v_purchase.status, v_purchase.acorns_awarded, cs.total_saved, cs.xp, cs.acorn_balance
      from character_stats cs where cs.user_id = v_purchase.user_id;
    return;
  end if;

  -- No coupon claimed at all: nothing grows the character for this one,
  -- XP included -- see the comment above this function for why.
  if v_purchase.coupon_id is null then
    update purchases set status = 'rejected', validated_at = now()
      where id = p_purchase_id;

    return query
      select 'rejected'::text, 0, cs.total_saved, cs.xp, cs.acorn_balance
      from character_stats cs where cs.user_id = v_purchase.user_id;
    return;
  end if;

  select * into v_coupon from coupons where id = v_purchase.coupon_id;

  select * into v_validation from coupon_validations
    where coupon_id = v_purchase.coupon_id
      and user_id = v_purchase.user_id
      and worked = true
    order by validated_at desc
    limit 1;

  if v_validation is null then
    -- Claimed a coupon but never logged a successful validation of it
    -- as this user -- reject rather than silently drop the coupon_id
    -- and award on the self-reported number anyway.
    update purchases set status = 'rejected', validated_at = now()
      where id = p_purchase_id;

    return query
      select 'rejected'::text, 0, cs.total_saved, cs.xp, cs.acorn_balance
      from character_stats cs where cs.user_id = v_purchase.user_id;
    return;
  end if;

  v_awarded_savings := v_purchase.savings;

  if v_coupon.discount_type = 'percent' and v_coupon.discount_value is not null and v_validation.cart_total is not null then
    v_cap := v_validation.cart_total * (v_coupon.discount_value / 100.0);
  elsif v_coupon.discount_type in ('fixed', 'shipping') and v_coupon.discount_value is not null then
    v_cap := v_coupon.discount_value;
  else
    -- Unknown discount shape or missing cart_total: nothing better to
    -- check against, so fall back to the self-reported number.
    v_cap := v_awarded_savings;
  end if;

  v_awarded_savings := least(v_awarded_savings, v_cap);
  v_acorns := floor(v_awarded_savings / 5)::integer; -- $5 saved = 1 acorn, mirrors XP_PER_ACORN in src/lib/squirrelScene.js

  update purchases
    set status = 'validated',
        savings = v_awarded_savings,
        acorns_awarded = v_acorns,
        validated_at = now()
    where id = p_purchase_id;

  if v_acorns > 0 then
    insert into acorn_ledger (user_id, purchase_id, delta, reason)
    values (v_purchase.user_id, p_purchase_id, v_acorns, 'purchase validated');
  end if;

  return query
    select 'validated'::text, v_acorns, cs.total_saved, cs.xp, cs.acorn_balance
    from character_stats cs where cs.user_id = v_purchase.user_id;
end;
$$;

grant execute on function validate_purchase(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- redeem_acorns: minimal stub for spending the balance -- what it's
-- redeemed FOR (gift cards, donations, in-game skins) is still an open
-- call per the team, so this only handles the part that has to be
-- correct no matter what that turns out to be: atomically checking the
-- balance and debiting it, so a redemption request can never be created
-- without a matching ledger entry.
-- ---------------------------------------------------------------------------
create or replace function redeem_acorns(p_amount integer, p_reward_type text, p_reward_detail text default '')
returns table (redemption_id uuid, acorn_balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_redemption_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;

  -- acorn_balances is a sum over a ledger, not a row -- there's nothing
  -- to `for update` lock, so serialize per-user with an advisory lock
  -- instead (released at transaction end) to stop two concurrent
  -- redemptions from both reading the same balance and overspending it.
  perform pg_advisory_xact_lock(hashtext(auth.uid()::text)::bigint);

  select coalesce(balance, 0) into v_balance from acorn_balances where user_id = auth.uid();

  if v_balance < p_amount then
    raise exception 'insufficient acorn balance';
  end if;

  insert into acorn_redemptions (user_id, acorns_spent, reward_type, reward_detail)
  values (auth.uid(), p_amount, p_reward_type, p_reward_detail)
  returning id into v_redemption_id;

  insert into acorn_ledger (user_id, purchase_id, delta, reason)
  values (auth.uid(), null, -p_amount, 'redeemed: ' || p_reward_type);

  return query select v_redemption_id, (v_balance - p_amount);
end;
$$;

grant execute on function redeem_acorns(integer, text, text) to authenticated;
