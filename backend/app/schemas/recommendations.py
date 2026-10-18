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
