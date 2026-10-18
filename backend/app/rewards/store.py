"""Storage for earning. Everything goes through RewardsStore, so the
in-memory version here can be swapped for a Supabase one with the same
methods without touching the rules, settlement or routes.

Method -> Supabase table it maps to:
    get_profile / award / set_streak    profiles (award = award_acorns RPC)
    get_checkout_session / complete_... checkout_sessions
    *decision*                          decisions
    *purchase_event*                    purchase_events
    *saved_item*                        saved_items
"""

from datetime import date, datetime
from threading import RLock
from typing import Protocol

from app.rewards.models import (
    CheckoutSession,
    DecisionRecord,
    DecisionStatus,
    Profile,
    PurchaseEvent,
    SavedItem,
    SavedStatus,
)


class DuplicateError(Exception):
    """A unique key (one decision per session, one event per order_ref) already exists."""


class RewardsStore(Protocol):
    def get_profile(self, user_id: str) -> Profile: ...  # creates on first use
    def award(self, user_id: str, amount: int) -> Profile: ...  # adds to total_xp and acorn_balance atomically
    def set_streak(self, user_id: str, streak: int) -> None: ...

    def get_checkout_session(self, session_id: str) -> CheckoutSession | None: ...
    def complete_checkout_session(self, session_id: str, now: datetime) -> None: ...

    def add_decision(self, decision: DecisionRecord) -> None: ...  # DuplicateError on repeat session
    def update_decision(self, decision: DecisionRecord) -> None: ...
    def get_decision(self, decision_id: str) -> DecisionRecord | None: ...
    def list_decisions(self, user_id: str, status: DecisionStatus | None = None) -> list[DecisionRecord]: ...

    def add_purchase_event(self, event: PurchaseEvent) -> None: ...  # DuplicateError on repeat order_ref
    def get_purchase_event_by_ref(self, user_id: str, order_ref: str) -> PurchaseEvent | None: ...

    def add_saved_item(self, item: SavedItem) -> None: ...
    def update_saved_item(self, item: SavedItem) -> None: ...
    def get_saved_item(self, user_id: str, item_id: str) -> SavedItem | None: ...
    def list_saved_items(self, user_id: str, status: SavedStatus | None = None) -> list[SavedItem]: ...

    def earned_on(self, user_id: str, day: date) -> int: ...  # acorns paid that day, for the daily cap


class InMemoryStore:
    """Process-local storage for development and tests. Data is lost on restart."""

    def __init__(self) -> None:
        self.lock = RLock()  # routes hold this for a whole request
        self._profiles: dict[str, Profile] = {}
        self._sessions: dict[str, CheckoutSession] = {}
        self._decisions: dict[str, DecisionRecord] = {}
        self._events: dict[str, PurchaseEvent] = {}
        self._saved: dict[str, SavedItem] = {}

    # --- profiles ---
    def get_profile(self, user_id: str) -> Profile:
        with self.lock:
            return self._profiles.setdefault(user_id, Profile(id=user_id))

    def award(self, user_id: str, amount: int) -> Profile:
        if amount < 0:
            raise ValueError("award amount must be non-negative")
        with self.lock:
            profile = self.get_profile(user_id)
            profile.total_xp += amount
            profile.acorn_balance += amount
            return profile

    def set_streak(self, user_id: str, streak: int) -> None:
        with self.lock:
            self.get_profile(user_id).current_streak = streak

    # --- checkout sessions (written by the conversation side) ---
    def add_checkout_session(self, session: CheckoutSession) -> None:
        """Not part of RewardsStore: tests and the demo seed use it to stand in
        for the conversation side."""
        with self.lock:
            self._sessions[session.id] = session

    def get_checkout_session(self, session_id: str) -> CheckoutSession | None:
        with self.lock:
            return self._sessions.get(session_id)

    def complete_checkout_session(self, session_id: str, now: datetime) -> None:
        with self.lock:
            session = self._sessions.get(session_id)
            if session and session.status == "active":
                session.status, session.completed_at = "completed", now

    # --- decisions ---
    def add_decision(self, decision: DecisionRecord) -> None:
        with self.lock:
            if any(d.session_id == decision.session_id for d in self._decisions.values()):
                raise DuplicateError(f"session {decision.session_id} already has a decision")
            self._decisions[decision.id] = decision

    def update_decision(self, decision: DecisionRecord) -> None:
        with self.lock:
            self._decisions[decision.id] = decision

    def get_decision(self, decision_id: str) -> DecisionRecord | None:
        with self.lock:
            return self._decisions.get(decision_id)

    def list_decisions(self, user_id: str, status: DecisionStatus | None = None) -> list[DecisionRecord]:
        with self.lock:
            found = [
                d for d in self._decisions.values()
                if d.user_id == user_id and (status is None or d.status == status)
            ]
        return sorted(found, key=lambda d: d.created_at, reverse=True)

    # --- purchase events ---
    def add_purchase_event(self, event: PurchaseEvent) -> None:
        with self.lock:
            if self.get_purchase_event_by_ref(event.user_id, event.order_ref):
                raise DuplicateError(f"order {event.order_ref} already recorded")
            self._events[event.id] = event

    def get_purchase_event_by_ref(self, user_id: str, order_ref: str) -> PurchaseEvent | None:
        with self.lock:
            return next(
                (e for e in self._events.values() if e.user_id == user_id and e.order_ref == order_ref),
                None,
            )

    # --- saved items ---
    def add_saved_item(self, item: SavedItem) -> None:
        with self.lock:
            self._saved[item.id] = item

    def update_saved_item(self, item: SavedItem) -> None:
        with self.lock:
            self._saved[item.id] = item

    def get_saved_item(self, user_id: str, item_id: str) -> SavedItem | None:
        with self.lock:
            item = self._saved.get(item_id)
            return item if item and item.user_id == user_id else None

    def list_saved_items(self, user_id: str, status: SavedStatus | None = None) -> list[SavedItem]:
        with self.lock:
            found = [
                s for s in self._saved.values()
                if s.user_id == user_id and (status is None or s.status == status)
            ]
        return sorted(found, key=lambda s: s.saved_at, reverse=True)

    # --- daily cap ---
    def earned_on(self, user_id: str, day: date) -> int:
        """Decision payouts locked that day plus saved-item bonuses awarded that day."""
        with self.lock:
            decisions = sum(
                d.total_acorns - d.delayed_bonus_acorns
                for d in self._decisions.values()
                if d.user_id == user_id and d.status == "locked" and d.locked_at and d.locked_at.date() == day
            )
            bonuses = sum(
                s.bonus_acorns
                for s in self._saved.values()
                if s.user_id == user_id and s.bonus_awarded_at and s.bonus_awarded_at.date() == day
            )
        return decisions + bonuses
