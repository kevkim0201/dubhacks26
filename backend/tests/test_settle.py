from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.rewards import settle
from app.rewards.models import CheckoutSession, Item, PurchaseEvent
from app.rewards.store import DuplicateError, InMemoryStore

T0 = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
TIMING = settle.Timing()
USER = "user-1"
SHOP = "pinecone.shop"


@pytest.fixture
def store():
    return InMemoryStore()


def session(store, *, name="Trailhead Hoodie", total=89.99, user=USER, shop=SHOP):
    """Stand in for the conversation side creating a checkout session."""
    s = CheckoutSession(id=str(uuid4()), user_id=user, store=shop,
                        items=[Item(name=name, price=total)], cart_total=total,
                        reason_summary="test reason")
    store.add_checkout_session(s)
    return s


def decide(store, decision, *, at=T0, **cart):
    s = session(store, **cart)
    return settle.record_decision(store, USER, s.id, decision, at, TIMING)


def purchase(store, *, ref="PK-1", name="Trailhead Hoodie", at=T0, shop=SHOP):
    event = PurchaseEvent(user_id=USER, order_ref=ref, store=shop, items=[Item(name=name, price=89.99)],
                          total=89.99, created_at=at)
    store.add_purchase_event(event)
    return settle.apply_purchase(store, event, at)


def totals(store):
    p = store.get_profile(USER)
    return p.total_xp, p.acorn_balance


# --- decisions ---

def test_buy_pays_immediately(store):
    d = decide(store, "buy")
    assert (d.status, d.total_acorns, d.locked_at) == ("locked", 20, T0)
    assert totals(store) == (20, 20)


def test_decision_copies_the_cart_and_reason_from_the_session(store):
    d = decide(store, "buy", name="Gym Headphones", total=89.99)
    assert (d.store, d.items[0].name, d.cart_total, d.reason_summary) == (SHOP, "Gym Headphones", 89.99, "test reason")


def test_decision_completes_the_checkout_session(store):
    s = session(store)
    settle.record_decision(store, USER, s.id, "buy", T0, TIMING)
    assert (s.status, s.completed_at) == ("completed", T0)


def test_someone_elses_session_is_rejected(store):
    s = session(store, user="someone-else")
    with pytest.raises(settle.SessionNotFound):
        settle.record_decision(store, USER, s.id, "buy", T0, TIMING)
    with pytest.raises(settle.SessionNotFound):
        settle.record_decision(store, USER, "no-such-session", "buy", T0, TIMING)


def test_one_decision_per_session(store):
    s = session(store)
    settle.record_decision(store, USER, s.id, "save", T0, TIMING)
    with pytest.raises(DuplicateError):
        settle.record_decision(store, USER, s.id, "skip", T0, TIMING)
    assert totals(store) == (30, 30)
    assert store.get_profile(USER).current_streak == 1  # the rejected decision changed nothing


# --- skip ---

def test_skip_is_pending_until_available_at_then_pays(store):
    d = decide(store, "skip")
    assert (d.status, d.total_acorns, d.available_at) == ("pending", 84, T0 + TIMING.skip_lock)
    assert totals(store) == (0, 0)

    assert settle.settle_due(store, USER, T0 + TIMING.skip_lock - timedelta(seconds=1)) == []
    [change] = settle.settle_due(store, USER, T0 + TIMING.skip_lock)
    assert (change.kind, change.acorns) == ("skip_locked", 84)
    assert d.status == "locked"
    assert totals(store) == (84, 84)


def test_buying_a_skipped_item_cancels_the_skip(store):
    d = decide(store, "skip")
    [change] = purchase(store, name="Trailhead Hoodie - Grey", at=T0 + timedelta(days=2))
    assert change.kind == "skip_cancelled"
    assert (d.status, d.cancelled_at) == ("cancelled", T0 + timedelta(days=2))
    settle.settle_due(store, USER, T0 + TIMING.skip_lock)
    assert totals(store) == (0, 0)


def test_unrelated_or_earlier_purchases_leave_the_skip_alone(store):
    d = decide(store, "skip", at=T0)
    purchase(store, ref="A", name="Gym Headphones", at=T0 + timedelta(days=1))
    purchase(store, ref="B", at=T0 - timedelta(minutes=1))
    assert d.status == "pending"


# --- save ---

def test_save_pays_now_and_saves_each_item(store):
    d = decide(store, "save")
    assert (d.status, d.total_acorns) == ("locked", 30)
    [saved] = store.list_saved_items(USER, "waiting")
    assert (saved.item_key, saved.item_name, saved.bonus_eligible_at) == (
        "pinecone.shop|trailhead hoodie", "Trailhead Hoodie", T0 + TIMING.save_bonus_wait)
    assert totals(store) == (30, 30)


def test_saved_item_bought_after_the_wait_earns_the_bonus(store):
    d = decide(store, "save")
    [change] = purchase(store, at=T0 + TIMING.save_bonus_wait)
    assert (change.kind, change.acorns) == ("saved_bought", 20)
    assert (d.delayed_bonus_acorns, d.total_acorns) == (20, 50)
    assert totals(store) == (50, 50)


def test_saved_item_bought_too_soon_gets_no_bonus(store):
    decide(store, "save")
    purchase(store, at=T0 + timedelta(hours=1))
    [saved] = store.list_saved_items(USER)
    assert (saved.status, saved.bonus_acorns, saved.bonus_awarded_at) == ("bought", 0, None)
    assert totals(store) == (30, 30)


# --- streak and daily cap ---

def test_third_non_buy_in_a_row_includes_the_streak_bonus(store):
    decide(store, "save")
    decide(store, "save")
    third = decide(store, "skip", total=0)
    assert (third.base_acorns, third.streak_bonus_acorns, third.total_acorns) == (40, 25, 65)


def test_buy_resets_the_streak(store):
    decide(store, "save")
    decide(store, "buy")
    assert store.get_profile(USER).current_streak == 0


def test_daily_cap_limits_what_is_paid(store):
    for i in range(11):  # 11 buys x 20 = 220, then saves push past 300
        decide(store, "buy", name=f"Item {i}")
    for i in range(4):
        decide(store, "save", name=f"Saved {i}")
    assert totals(store) == (300, 300)
    assert store.earned_on(USER, T0.date()) == 300


def test_daily_cap_resets_the_next_day(store):
    for i in range(15):
        decide(store, "buy", name=f"Item {i}")
    decide(store, "buy", name="Tomorrow", at=T0 + timedelta(days=1))
    assert totals(store) == (320, 320)


def test_a_same_day_save_bonus_is_counted_once_toward_the_cap(store):
    instant_bonus = settle.Timing(save_bonus_wait=timedelta(0))
    s = session(store)
    settle.record_decision(store, USER, s.id, "save", T0, instant_bonus)
    purchase(store, at=T0)
    assert totals(store) == (50, 50)
    assert store.earned_on(USER, T0.date()) == 50
