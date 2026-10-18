"""Turns checkout decisions, completed purchases and the passage of time
into acorns (the design doc's rules).

    Decision  When decided                    Later
    buy       +20, locked (paid now)          --
    save      +30, locked (paid now);         matching purchase after bonus_eligible_at:
              items go to saved_items           +20 bonus (delayed_bonus_acorns)
    skip      40 + $1 per $2 kept (max 150),  matching purchase before available_at: cancelled, 0
              pending until available_at      reaching available_at: locked (paid)

Every payout goes through the daily cap and then award(), which adds to
total_xp and acorn_balance together. Pending acorns don't count toward XP
or the tier until they lock. All functions take `now`, so tests and the
demo control time.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from app.rewards import rules
from app.rewards.matching import item_key, purchase_matches, purchase_matches_key
from app.rewards.models import DecisionRecord, PurchaseEvent, SavedItem
from app.rewards.store import RewardsStore


class SessionNotFound(Exception):
    """No checkout session with that id belongs to this user."""


@dataclass(frozen=True)
class Timing:
    skip_lock: timedelta = timedelta(days=7)
    save_bonus_wait: timedelta = timedelta(hours=48)


ChangeKind = Literal["skip_locked", "skip_cancelled", "saved_bought"]


@dataclass(frozen=True)
class Change:
    kind: ChangeKind
    decision_id: str
    saved_item_id: str | None = None
    acorns: int = 0  # actually paid by this change


def pay(store: RewardsStore, user_id: str, amount: int, now: datetime) -> int:
    """Credit acorns under the daily cap. Returns what was actually paid."""
    granted = rules.capped_amount(amount, store.earned_on(user_id, now.date()))
    if granted:
        store.award(user_id, granted)
    return granted


def record_decision(
    store: RewardsStore,
    user_id: str,
    session_id: str,
    decision: rules.Decision,
    now: datetime,
    timing: Timing,
) -> DecisionRecord:
    """Save Buy / Save / Skip for a checkout session and pay what's due now.

    The cart comes from the checkout session the conversation side wrote,
    never from the request. Raises SessionNotFound, or DuplicateError if the
    session already has a decision.
    """
    session = store.get_checkout_session(session_id)
    if session is None or session.user_id != user_id:
        raise SessionNotFound(session_id)

    profile = store.get_profile(user_id)
    streak, streak_bonus = rules.next_streak(profile.current_streak, decision)
    base = rules.decision_reward(decision, session.cart_total)
    record = DecisionRecord(
        user_id=user_id,
        session_id=session.id,
        store=session.store,
        items=session.items,
        cart_total=session.cart_total,
        currency=session.currency,
        decision=decision,
        base_acorns=base,
        streak_bonus_acorns=streak_bonus,
        total_acorns=base + streak_bonus,
        status="pending",
        reason_summary=session.reason_summary,
        created_at=now,
    )
    store.add_decision(record)  # the duplicate check happens before anything changes

    store.set_streak(user_id, streak)
    store.complete_checkout_session(session.id, now)

    if decision == "skip":
        record.available_at = now + timing.skip_lock
    else:
        # Buy and save pay right away. Count the cap before marking it locked,
        # so this decision isn't counted against itself.
        paid = pay(store, user_id, record.total_acorns, now)
        record.total_acorns, record.status, record.locked_at = paid, "locked", now
    store.update_decision(record)

    if decision == "save":
        for item in session.items:
            store.add_saved_item(SavedItem(
                user_id=user_id,
                source_decision_id=record.id,
                item_key=item_key(session.store, item.name),
                item_name=item.name,
                item_price=item.price,
                quantity=item.qty,
                item_url=item.url,
                currency=session.currency,
                saved_at=now,
                bonus_eligible_at=now + timing.save_bonus_wait,
            ))
    return record


def settle_due(store: RewardsStore, user_id: str, now: datetime) -> list[Change]:
    """Pay out skips whose available_at has arrived (oldest first)."""
    changes = []
    for decision in reversed(store.list_decisions(user_id, status="pending")):
        if decision.available_at and decision.available_at <= now:
            paid = pay(store, user_id, decision.total_acorns, now)
            decision.total_acorns, decision.status, decision.locked_at = paid, "locked", now
            store.update_decision(decision)
            changes.append(Change("skip_locked", decision.id, acorns=paid))
    return changes


def apply_purchase(store: RewardsStore, event: PurchaseEvent, now: datetime) -> list[Change]:
    """Settle what a completed purchase affects: cancel matching pending
    skips, mark matching saved items bought (with the bonus if they waited)."""
    changes: list[Change] = []

    for decision in store.list_decisions(event.user_id, status="pending"):
        if decision.created_at <= event.created_at and purchase_matches(
            event.store, event.items, decision.store, decision.items
        ):
            decision.status, decision.cancelled_at = "cancelled", now
            store.update_decision(decision)
            changes.append(Change("skip_cancelled", decision.id))

    for saved in store.list_saved_items(event.user_id, status="waiting"):
        if saved.saved_at > event.created_at or not purchase_matches_key(event.store, event.items, saved.item_key):
            continue
        saved.status, saved.purchase_detected_at = "bought", now
        if now >= saved.bonus_eligible_at:
            saved.bonus_acorns = pay(store, event.user_id, saved.bonus_acorns, now)
            saved.bonus_awarded_at = now
            source = store.get_decision(saved.source_decision_id)
            if source:
                source.delayed_bonus_acorns += saved.bonus_acorns
                source.total_acorns += saved.bonus_acorns
                store.update_decision(source)
        else:
            saved.bonus_acorns = 0  # bought before the wait was over
        store.update_saved_item(saved)
        changes.append(Change("saved_bought", saved.source_decision_id, saved.id, acorns=saved.bonus_acorns))

    return changes
