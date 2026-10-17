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
  created_at timestamptz not null default now()
);

alter table purchases enable row level security;

create policy "purchases are owner-readable" on purchases
  for select using (auth.uid() = user_id);

create policy "purchases are owner-writable" on purchases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists purchases_user_id_idx on purchases (user_id);
create index if not exists purchases_return_deadline_idx on purchases (return_deadline) where returned = false;

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

create policy "coupon validations are insertable by signed-in users" on coupon_validations
  for insert with check (auth.uid() is not null);
