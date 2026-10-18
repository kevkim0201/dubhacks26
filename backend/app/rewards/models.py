"""Records the rewards code reads and writes, named after the Supabase
tables in supabase/schema.sql (Kevin) and supabase/purchases.sql (Deetya).
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import uuid4

from app.rewards.rules import Decision

# pending:   a skip waiting until available_at
# locked:    paid out
# cancelled: the skipped item was bought anyway -- no acorns
DecisionStatus = Literal["pending", "locked", "cancelled"]
SavedStatus = Literal["waiting", "bought", "dropped"]
SessionStatus = Literal["active", "completed", "abandoned"]


def new_id() -> str:
    return str(uuid4())


@dataclass
class Item:
    name: str
    price: float
    qty: int = 1
    url: str | None = None


@dataclass
class Profile:
    """profiles: XP, acorns and streak. The tier is worked out from total_xp."""
    id: str
    total_xp: int = 0           # never goes down, decides the tier
    acorn_balance: int = 0      # spendable (spending is the game side's job)
    current_streak: int = 0


@dataclass
class CheckoutSession:
    """checkout_sessions: written by the conversation side; read here."""
    id: str
    user_id: str
    store: str
    items: list[Item]
    cart_total: float
    currency: str = "USD"
    status: SessionStatus = "active"
    reason_summary: str | None = None
    completed_at: datetime | None = None


@dataclass
class DecisionRecord:
    """decisions: one per checkout session, and the reward ledger."""
    user_id: str
    session_id: str
    store: str
    items: list[Item]
    cart_total: float
    decision: Decision
    base_acorns: int
    streak_bonus_acorns: int
    total_acorns: int           # pending: promised; locked: actually paid (after the daily cap)
    status: DecisionStatus
    created_at: datetime
    currency: str = "USD"
    delayed_bonus_acorns: int = 0   # saved-item bonus, paid later
    reason_summary: str | None = None
    available_at: datetime | None = None
    locked_at: datetime | None = None
    cancelled_at: datetime | None = None
    id: str = field(default_factory=new_id)


@dataclass
class PurchaseEvent:
    """purchase_events: an order seen on a confirmation page."""
    user_id: str
    order_ref: str
    store: str
    items: list[Item]
    total: float
    created_at: datetime
    currency: str = "USD"
    session_id: str | None = None
    id: str = field(default_factory=new_id)


@dataclass
class SavedItem:
    """saved_items: one per item in a "save for later" cart."""
    user_id: str
    source_decision_id: str
    item_key: str               # "<store>|<item name>", normalized -- see matching.item_key
    item_name: str
    item_price: float
    saved_at: datetime
    bonus_eligible_at: datetime
    quantity: int = 1
    currency: str = "USD"
    item_url: str | None = None
    status: SavedStatus = "waiting"
    purchase_detected_at: datetime | None = None
    bonus_awarded_at: datetime | None = None
    bonus_acorns: int = 20      # paid if bought after bonus_eligible_at; 0 if bought sooner
    id: str = field(default_factory=new_id)
