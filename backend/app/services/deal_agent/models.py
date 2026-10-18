"""Request, response and stream-event models for the deal agent (contract in DEAL_AGENT_PLAN.md)."""

from typing import Literal

from pydantic import BaseModel, Field

Verdict = Literal["great_deal", "fair", "overpriced"]


class Identifier(BaseModel):
    type: Literal["gtin", "asin", "upc", "mpn"]
    value: str = Field(min_length=1, max_length=64)


class DealRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    # Required by the contract, but validated in the route so a missing price gets a clear 422.
    price: float | None = Field(default=None, ge=0)
    shipping: float = Field(default=0, ge=0)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    url: str = Field(min_length=1, max_length=2048)
    domain: str | None = Field(default=None, max_length=255)
    identifier: Identifier | None = None
    brand: str | None = Field(default=None, max_length=120)
    condition: str = Field(default="new", max_length=40)
    # Optional: why the shopper wants it (e.g. from the Pip conversation). Steers "similar picks".
    need: str | None = Field(default=None, max_length=500)
    category: str | None = Field(default=None, max_length=60)

    @property
    def current_total(self) -> float:
        return round((self.price or 0) + self.shipping, 2)


class Offer(BaseModel):
    seller: str
    price: float
    shipping: float = 0
    total: float
    savings: float
    link: str
    condition: str = "new"
    match_confidence: float = Field(ge=0, le=1)
    reason: str = ""


class Alternative(BaseModel):
    """A different, cheaper product that meets the same need."""

    title: str
    seller: str
    price: float
    shipping: float = 0
    total: float
    savings: float
    link: str
    condition: str = "new"
    fit_score: float = Field(ge=0, le=1)
    why: str = ""  # why it meets the shopper's need
    tradeoff: str = ""  # what you give up vs. the original
    thumbnail: str | None = None


class Coupon(BaseModel):
    code: str
    description: str
    source: str = "static"


class DealResponse(BaseModel):
    verdict: Verdict
    verdict_reason: str
    current_total: float
    best_total: float
    max_savings: float
    acorns: int
    offers: list[Offer] = Field(default_factory=list)
    # Different products that do the same job for less (not counted in verdict / savings / acorns).
    alternatives: list[Alternative] = Field(default_factory=list)
    coupons: list[Coupon] = Field(default_factory=list)
    cached: bool = False
