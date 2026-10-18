from typing import List, Union
from pydantic import BaseModel, Field


class CartItemInput(BaseModel):
    name: str = Field(..., min_length=1)
    price: float | None = None
    quantity: int = 1


class RecommendationsRequest(BaseModel):
    items: List[Union[CartItemInput, str]] = Field(default_factory=list)
    total_cost: float = Field(default=0.0, ge=0.0)
    store_domain: str = Field(default="unknown")


class ProductRecommendation(BaseModel):
    id: str
    title: str
    estimated_price: float
    estimated_savings: float
    pip_reason: str
    search_query: str
    search_url: str


class RecommendationsResponse(BaseModel):
    recommendations: List[ProductRecommendation]
    summary: str


class ScrapedDeal(BaseModel):
    id: str
    title: str
    price: float
    estimated_savings: float
    seller: str
    url: str
    image: str | None = None
    pip_reason: str
    badge: str = "Deal Found"


class BuyDealsRequest(BaseModel):
    item_name: str = Field(..., min_length=1)
    cart_total: float = Field(default=0.0, ge=0.0)
    store_domain: str = Field(default="unknown")
    verdict: str = Field(default="buy")
    decision: str = Field(default="buy")


class BuyDealsResponse(BaseModel):
    item_name: str
    cart_total: float
    store_domain: str
    jev_evaluated: bool
    deals: List[ScrapedDeal]
    summary: str
