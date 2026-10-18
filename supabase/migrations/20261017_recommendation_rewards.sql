-- Replace the flat/pending reward model with recommendation-based rewards.
-- Existing unresolved escrow rows are preserved by stopping for manual review.

begin;

do $$
begin
  if exists (
    select 1
    from public.decisions
    where status in ('pending', 'cancelled')
  ) then
    raise exception
      'Resolve pending/cancelled decisions before applying recommendation rewards migration';
  end if;
end;
$$;

alter table public.decisions
  add column recommended_decision text
    check (recommended_decision in ('buy', 'save', 'skip')),
  add column recommendation_matched boolean,
  add column requested_acorns integer not null default 0
    check (requested_acorns >= 0),
  add column engagement_acorns integer not null default 0
    check (engagement_acorns >= 0),
  add column decision_bonus_acorns integer not null default 0
    check (decision_bonus_acorns >= 0),
  add column xp_awarded bigint not null default 0
    check (xp_awarded >= 0),
  add column daily_cap_applied boolean not null default false,
  add column legacy_reward_breakdown jsonb;

update public.decisions d
set legacy_reward_breakdown = jsonb_build_object(
      'base_acorns', d.base_acorns,
      'streak_bonus_acorns', d.streak_bonus_acorns,
      'delayed_bonus_acorns', d.delayed_bonus_acorns
    ),
    requested_acorns = d.total_acorns,
    engagement_acorns = d.total_acorns,
    xp_awarded = d.total_acorns;

update public.decisions d
set recommended_decision = case s.suggestion
      when 'wait' then 'save'
      else s.suggestion
    end,
    recommendation_matched = d.decision = case s.suggestion
      when 'wait' then 'save'
      else s.suggestion
    end
from public.checkout_sessions s
where d.session_id = s.id
  and s.suggestion is not null;

alter table public.decisions
  add constraint decisions_reward_breakdown_check
    check (total_acorns = engagement_acorns + decision_bonus_acorns),
  add constraint decisions_xp_matches_acorns_check
    check (xp_awarded = total_acorns);

drop index if exists public.decisions_pending_available_idx;
drop index if exists public.decisions_locked_user_created_idx;
drop index if exists public.saved_items_user_status_idx;

alter table public.decisions
  drop column base_acorns,
  drop column streak_bonus_acorns,
  drop column delayed_bonus_acorns,
  drop column status,
  drop column available_at,
  drop column locked_at,
  drop column cancelled_at;

alter table public.profiles
  drop column current_streak;

alter table public.saved_items
  drop column bonus_eligible_at,
  drop column bonus_awarded_at,
  drop column bonus_acorns;

create index saved_items_user_status_idx
  on public.saved_items (user_id, status, saved_at desc);

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

commit;
