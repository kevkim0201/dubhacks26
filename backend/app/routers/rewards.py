"""Earning API: checkout decisions, completed purchases, and the user's acorns.

The signed-in user comes from the Supabase token (AuthUser), never from the
request body, and the cart comes from the checkout session the conversation
side saved -- so nobody can earn acorns for someone else or for a made-up cart.
"""

from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import AuthUser
from app.core.config import get_settings
from app.rewards import rules, settle
from app.rewards.models import DecisionRecord, Item, PurchaseEvent, SavedItem
from app.rewards.store import DuplicateError, InMemoryStore, RewardsStore

router = APIRouter(prefix="/api", tags=["earning"])

_store = InMemoryStore()  # swap for a Supabase-backed RewardsStore later


def get_store() -> RewardsStore:
    return _store


def get_now() -> datetime:
    return datetime.now(timezone.utc)


def get_timing() -> settle.Timing:
    s = get_settings()
    return settle.Timing(
        skip_lock=timedelta(seconds=s.reward_skip_lock_seconds),
        save_bonus_wait=timedelta(seconds=s.reward_save_bonus_seconds),
    )


Store = Annotated[RewardsStore, Depends(get_store)]
Now = Annotated[datetime, Depends(get_now)]
TimingDep = Annotated[settle.Timing, Depends(get_timing)]


# ======================== Request / response shapes ========================

class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    price: float = Field(ge=0)
    qty: int = Field(default=1, ge=1)
    url: str | None = Field(default=None, max_length=2000)


class DecisionIn(BaseModel):
    session_id: UUID = Field(description="The checkout session the conversation created")
    decision: rules.Decision


class PurchaseIn(BaseModel):
    order_ref: str = Field(min_length=1, max_length=128, description="The store's order number")
    store: str = Field(min_length=1, max_length=200)
    items: list[ItemIn] = Field(min_length=1)
    total: float = Field(ge=0)
    currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    session_id: UUID | None = Field(default=None, description="Checkout session, if the extension knows it")


class Totals(BaseModel):
    total_earned: int = Field(description="XP (profiles.total_xp): never goes down, decides the tier")
    balance: int = Field(description="Spendable acorns (profiles.acorn_balance)")
    pending_acorns: int = Field(description="Skip acorns waiting to pay out")
    tier: str
    next_tier: str | None
    next_tier_at: int | None
    tier_up: bool = Field(description="This request moved the user into a new tier: play the evolution")


class DecisionOut(Totals):
    decision_id: str
    status: str = Field(description="locked (buy, save) or pending (skip)")
    acorns_awarded: int = Field(description="Paid now (buy, save) or promised (skip)")


class ChangeOut(BaseModel):
    kind: settle.ChangeKind
    decision_id: str
    saved_item_id: str | None
    acorns: int


class PurchaseOut(Totals):
    purchase_event_id: str
    duplicate: bool = Field(description="This order_ref was already reported; nothing changed")
    changes: list[ChangeOut]


class DecisionSummary(BaseModel):
    id: str
    store: str
    items: list[ItemIn]
    cart_total: float
    decision: rules.Decision
    total_acorns: int
    status: str
    reason_summary: str | None
    created_at: datetime
    available_at: datetime | None


class SavedItemOut(BaseModel):
    id: str
    item_name: str
    item_price: float
    quantity: int
    saved_at: datetime
    bonus_eligible_at: datetime
    status: str


class UserState(Totals):
    money_kept: float = Field(description="Cart totals of skips that paid out")
    recent_decisions: list[DecisionSummary]
    saved_items: list[SavedItemOut] = Field(description="Saved for later, still waiting")


# ======================== Helpers ========================

def _locked(store: RewardsStore):
    """Hold the store's lock for the whole request, if it has one."""
    return getattr(store, "lock", None) or nullcontext()


def _totals(store: RewardsStore, user_id: str, xp_before: int) -> dict:
    profile = store.get_profile(user_id)
    tier = rules.tier_for(profile.total_xp)
    return {
        "total_earned": profile.total_xp,
        "balance": profile.acorn_balance,
        "pending_acorns": sum(d.total_acorns for d in store.list_decisions(user_id, status="pending")),
        "tier": tier.name,
        "next_tier": tier.next_name,
        "next_tier_at": tier.next_at,
        "tier_up": rules.tier_up(xp_before, profile.total_xp),
    }


def _summary(d: DecisionRecord) -> DecisionSummary:
    return DecisionSummary(
        id=d.id, store=d.store,
        items=[ItemIn(name=i.name, price=i.price, qty=i.qty, url=i.url) for i in d.items],
        cart_total=d.cart_total, decision=d.decision, total_acorns=d.total_acorns,
        status=d.status, reason_summary=d.reason_summary,
        created_at=d.created_at, available_at=d.available_at,
    )


def _saved(s: SavedItem) -> SavedItemOut:
    return SavedItemOut(id=s.id, item_name=s.item_name, item_price=s.item_price, quantity=s.quantity,
                        saved_at=s.saved_at, bonus_eligible_at=s.bonus_eligible_at, status=s.status)


# ======================== Routes ========================

@router.post("/checkout/decision", response_model=DecisionOut, status_code=status.HTTP_201_CREATED)
def post_decision(body: DecisionIn, user: AuthUser, store: Store, now: Now, timing: TimingDep) -> DecisionOut:
    """Buy it / Save for later / Skip, at the end of the checkout conversation.

    Buy and save pay now; skip is pending until its available_at. One
    decision per checkout session.
    """
    with _locked(store):
        xp_before = store.get_profile(user.id).total_xp
        settle.settle_due(store, user.id, now)
        try:
            record = settle.record_decision(store, user.id, str(body.session_id), body.decision, now, timing)
        except settle.SessionNotFound as exc:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Checkout session not found") from exc
        except DuplicateError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT, "This checkout already has a decision") from exc
        return DecisionOut(decision_id=record.id, status=record.status, acorns_awarded=record.total_acorns,
                           **_totals(store, user.id, xp_before))


@router.post("/purchases", response_model=PurchaseOut)
def post_purchase(body: PurchaseIn, user: AuthUser, store: Store, now: Now) -> PurchaseOut:
    """Report a completed order seen on the store's order-confirmation page.

    Cancels a matching pending skip and marks matching saved items bought
    (with the bonus if they waited). Reporting the same order_ref again
    changes nothing.
    """
    with _locked(store):
        xp_before = store.get_profile(user.id).total_xp
        existing = store.get_purchase_event_by_ref(user.id, body.order_ref)
        if existing:
            return PurchaseOut(purchase_event_id=existing.id, duplicate=True, changes=[],
                               **_totals(store, user.id, xp_before))

        # Only keep a session link that really belongs to this user.
        session_id = str(body.session_id) if body.session_id else None
        if session_id:
            session = store.get_checkout_session(session_id)
            if session is None or session.user_id != user.id:
                session_id = None

        changes = settle.settle_due(store, user.id, now)
        event = PurchaseEvent(
            user_id=user.id, order_ref=body.order_ref, store=body.store,
            items=[Item(name=i.name, price=i.price, qty=i.qty, url=i.url) for i in body.items],
            total=body.total, currency=body.currency, session_id=session_id, created_at=now,
        )
        store.add_purchase_event(event)
        changes += settle.apply_purchase(store, event, now)
        return PurchaseOut(purchase_event_id=event.id, duplicate=False,
                           changes=[ChangeOut(**c.__dict__) for c in changes],
                           **_totals(store, user.id, xp_before))


@router.get("/user/state", response_model=UserState)
def get_user_state(user: AuthUser, store: Store, now: Now) -> UserState:
    """Everything the popup and game page show: XP, acorns, tier, history."""
    with _locked(store):
        xp_before = store.get_profile(user.id).total_xp
        settle.settle_due(store, user.id, now)
        decisions = store.list_decisions(user.id)
        return UserState(
            money_kept=round(sum(d.cart_total for d in decisions
                                 if d.decision == "skip" and d.status == "locked"), 2),
            recent_decisions=[_summary(d) for d in decisions[:10]],
            saved_items=[_saved(s) for s in store.list_saved_items(user.id, status="waiting")],
            **_totals(store, user.id, xp_before),
        )


@router.post("/saved-items/{item_id}/drop", response_model=SavedItemOut)
def drop_saved_item(item_id: str, user: AuthUser, store: Store) -> SavedItemOut:
    """The user no longer wants a saved item."""
    with _locked(store):
        item = store.get_saved_item(user.id, item_id)
        if item is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Saved item not found")
        if item.status != "waiting":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Saved item is already {item.status}")
        item.status = "dropped"
        store.update_saved_item(item)
        return _saved(item)
