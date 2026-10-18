from typing import Any, Literal
from pydantic import BaseModel, Field


class CartItem(BaseModel):
    name: str
    price: float
    qty: int = 1


class CartData(BaseModel):
    store: str = "mock-store"
    items: list[CartItem] = Field(default_factory=list)
    total: float


class CheckoutStartRequest(BaseModel):
    user_id: str = "demo_user"
    cart: CartData


class CheckoutStartResponse(BaseModel):
    session_id: str
    opening_line: str
    voice_link: str | None = None


class CheckoutTurnRequest(BaseModel):
    session_id: str
    user_text: str


class CheckoutTurnResponse(BaseModel):
    reply_text: str
    reply_audio_url: str | None = None
    done: bool = False


class CheckoutDecisionRequest(BaseModel):
    session_id: str
    decision: Literal["buy", "save", "skip"]


class CheckoutDecisionResponse(BaseModel):
    acorns_awarded: int
    status: str
    total_earned: int
    balance: int
    tier: str
    tier_up: bool
    streak: int


class UserStateResponse(BaseModel):
    user_id: str
    total_earned: int
    balance: int
    tier: str
    next_tier_at: int | None
    streak: int
    recent_decisions: list[dict[str, Any]] = Field(default_factory=list)


class UserSeedRequest(BaseModel):
    user_id: str = "demo_user"
    total_earned: int = 980
    balance: int | None = None
