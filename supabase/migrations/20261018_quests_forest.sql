-- Personal weekly quests and each user's personal forest.
--
-- Run in the Supabase SQL Editor after schema.sql and the earlier
-- migrations. Safe to re-run. Additive only: it creates new tables and
-- functions and does not alter, drop or replace anything that already
-- exists.
--
-- Touches existing data in exactly two ways, both through single-row
-- atomic updates of public.profiles:
--   claim_quest_reward  adds a quest's reward to total_xp AND acorn_balance
--                       (so the tier-gift trigger fires as it does for decisions)
--   plant_trees         subtracts acorns from acorn_balance; XP is untouched,
--                       so a user's tier never drops
-- Quest rewards are not written to public.decisions, so they don't count
-- toward the decision daily cap.
--
-- Only the backend (service_role) writes. Users may read their own rows.

-- ---------------------------------------------------------------------------
-- user_quests: the 3 personal quests a user gets each week (Monday, UTC).
-- Progress is calculated by the backend from public.decisions; this table
-- holds the target, the reward and whether it was claimed.
-- ---------------------------------------------------------------------------
create table if not exists public.user_quests (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  week_start     date not null,
  slot           smallint not null check (slot between 1 and 3),
  quest_type     text not null check (quest_type in ('talk', 'follow', 'pause', 'kept')),
  level          integer not null check (level >= 1),
  target         numeric(10, 2) not null check (target > 0),
  reward_acorns  integer not null check (reward_acorns > 0),
  status         text not null default 'active' check (status in ('active', 'claimed')),
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  constraint user_quests_one_per_slot unique (user_id, week_start, slot),
  constraint user_quests_one_per_type unique (user_id, week_start, quest_type),
  constraint user_quests_claimed_has_time check ((status = 'claimed') = (claimed_at is not null))
);

create index if not exists user_quests_user_week_idx
  on public.user_quests (user_id, week_start);

-- ---------------------------------------------------------------------------
-- forest_plantings: acorns a user spent planting trees (100 acorns each).
-- 30 trees make a complete forest.
-- ---------------------------------------------------------------------------
create table if not exists public.forest_plantings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  trees         integer not null check (trees between 1 and 30),
  acorns_spent  integer not null check (acorns_spent > 0),
  created_at    timestamptz not null default now()
);

create index if not exists forest_plantings_user_idx
  on public.forest_plantings (user_id);

-- ---------------------------------------------------------------------------
-- forest_members: the name shown on the leaderboard ("Deetya K."), saved by
-- the backend from the user's sign-in profile when they open the forest.
-- ---------------------------------------------------------------------------
create table if not exists public.forest_members (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  display_name  text not null check (length(display_name) between 1 and 60),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access: row level security on; users read only their own rows; the
-- backend (service_role) does all writes.
-- ---------------------------------------------------------------------------
alter table public.user_quests enable row level security;
alter table public.forest_plantings enable row level security;
alter table public.forest_members enable row level security;

drop policy if exists "Users can read their own quests" on public.user_quests;
create policy "Users can read their own quests"
  on public.user_quests for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own plantings" on public.forest_plantings;
create policy "Users can read their own plantings"
  on public.forest_plantings for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own forest name" on public.forest_members;
create policy "Users can read their own forest name"
  on public.forest_members for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.user_quests, public.forest_plantings, public.forest_members from anon, authenticated;
grant select on public.user_quests, public.forest_plantings, public.forest_members to authenticated;
grant all on public.user_quests, public.forest_plantings, public.forest_members to service_role;

-- ---------------------------------------------------------------------------
-- claim_quest_reward: mark a quest claimed and pay its reward once.
-- The backend checks the quest is complete before calling this (it owns the
-- progress calculation); this function guarantees it can only pay once.
-- Errors: P0002 quest not found for this user; 55000 already claimed.
-- ---------------------------------------------------------------------------
create or replace function public.claim_quest_reward(p_user_id uuid, p_quest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reward  integer;
  v_profile public.profiles;
begin
  update public.user_quests q
     set status = 'claimed', claimed_at = now()
   where q.id = p_quest_id
     and q.user_id = p_user_id
     and q.status = 'active'
  returning q.reward_acorns into v_reward;

  if v_reward is null then
    if exists (select 1 from public.user_quests q where q.id = p_quest_id and q.user_id = p_user_id) then
      raise exception 'Quest reward already claimed' using errcode = '55000';
    end if;
    raise exception 'Quest not found' using errcode = 'P0002';
  end if;

  update public.profiles p
     set total_xp = p.total_xp + v_reward,
         acorn_balance = p.acorn_balance + v_reward
   where p.id = p_user_id
  returning * into v_profile;

  if v_profile.id is null then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'reward_acorns', v_reward,
    'xp_awarded', v_reward,
    'total_xp', v_profile.total_xp,
    'acorn_balance', v_profile.acorn_balance,
    'tier', v_profile.tier
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- plant_trees: spend 100 acorns per tree. Leaves XP alone.
-- Errors: 22023 invalid count or not enough acorns; P0002 no profile.
-- ---------------------------------------------------------------------------
create or replace function public.plant_trees(p_user_id uuid, p_trees integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cost    integer;
  v_balance bigint;
  v_trees   bigint;
begin
  if p_trees is null or p_trees < 1 or p_trees > 30 then
    raise exception 'Plant between 1 and 30 trees at a time' using errcode = '22023';
  end if;
  v_cost := p_trees * 100;

  update public.profiles p
     set acorn_balance = p.acorn_balance - v_cost
   where p.id = p_user_id
     and p.acorn_balance >= v_cost
  returning p.acorn_balance into v_balance;

  if v_balance is null then
    if exists (select 1 from public.profiles p where p.id = p_user_id) then
      raise exception 'Not enough acorns to plant % tree(s)', p_trees using errcode = '22023';
    end if;
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  insert into public.forest_plantings (user_id, trees, acorns_spent)
  values (p_user_id, p_trees, v_cost);

  select coalesce(sum(f.trees), 0) into v_trees
    from public.forest_plantings f
   where f.user_id = p_user_id;

  return jsonb_build_object(
    'trees_planted', p_trees,
    'acorns_spent', v_cost,
    'acorn_balance', v_balance,
    'total_trees', v_trees
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- forest_leaderboard: the top planters (trees, then completed forests) and
-- the given user's own row and rank. Read by the backend only, since users
-- can't read each other's rows.
-- ---------------------------------------------------------------------------
create or replace function public.forest_leaderboard(p_user_id uuid, p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with totals as (
    select f.user_id, sum(f.trees)::bigint as trees
      from public.forest_plantings f
     group by f.user_id
  ),
  ranked as (
    select t.user_id,
           coalesce(m.display_name, 'Forager') as display_name,
           t.trees,
           t.trees / 30 as forests,
           rank() over (order by t.trees desc) as rank
      from totals t
      left join public.forest_members m on m.user_id = t.user_id
  )
  select jsonb_build_object(
    'top', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank', r.rank, 'display_name', r.display_name,
               'trees', r.trees, 'forests', r.forests,
               'is_you', r.user_id = p_user_id)
             order by r.rank, r.display_name)
        from (select * from ranked order by rank, display_name limit greatest(1, least(p_limit, 50))) r
    ), '[]'::jsonb),
    'you', (
      select jsonb_build_object(
               'rank', r.rank, 'display_name', r.display_name,
               'trees', r.trees, 'forests', r.forests, 'is_you', true)
        from ranked r
       where r.user_id = p_user_id
    )
  );
$$;

revoke execute on function public.claim_quest_reward(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.plant_trees(uuid, integer) from public, anon, authenticated;
revoke execute on function public.forest_leaderboard(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_quest_reward(uuid, uuid) to service_role;
grant execute on function public.plant_trees(uuid, integer) to service_role;
grant execute on function public.forest_leaderboard(uuid, integer) to service_role;
