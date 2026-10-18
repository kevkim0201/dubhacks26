import hashlib
import json
import os
import urllib.parse
from typing import List

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import get_settings
from app.schemas.recommendations import ProductRecommendation, RecommendationsRequest, RecommendationsResponse


class JevItemOutput(BaseModel):
    title: str
    estimated_price: float
    pip_reason: str
    search_query: str


class JevPipelineOutput(BaseModel):
    alternatives: List[JevItemOutput]
    summary: str


def build_search_url(query: str, prefer_amazon: bool = False) -> str:
    """Builds a deterministic search URL without hallucinated product links."""
    clean_q = query.strip()
    encoded = urllib.parse.quote(clean_q)
    if prefer_amazon:
        return f"https://www.amazon.com/s?k={encoded}&tag=nook01-20"
    return f"https://www.google.com/search?tbm=shop&q={encoded}"


def generate_fallback_recommendations(cart_name: str, total_cost: float) -> List[ProductRecommendation]:
    """Deterministic heuristic fallback if LLM is unavailable."""
    base_price = total_cost if total_cost > 0 else 50.0
    
    # 1. Budget alternative
    budget_price = round(base_price * 0.60, 2)
    budget_savings = round(base_price - budget_price, 2)
    budget_query = f"affordable {cart_name} top rated"
    
    # 2. Refurbished / Value alternative
    refurb_price = round(base_price * 0.45, 2)
    refurb_savings = round(base_price - refurb_price, 2)
    refurb_query = f"certified refurbished {cart_name}"

    # 3. Open box / Warehouse deal
    open_box_price = round(base_price * 0.70, 2)
    open_box_savings = round(base_price - open_box_price, 2)
    open_box_query = f"open box deal {cart_name}"

    return [
        ProductRecommendation(
            id=hashlib.md5(budget_query.encode()).hexdigest()[:8],
            title=f"Top-Rated Budget Alternative ({cart_name})",
            estimated_price=budget_price,
            estimated_savings=budget_savings,
            pip_reason="Same core features, 4+ star reviews, and keeps extra acorns in your pocket!",
            search_query=budget_query,
            search_url=build_search_url(budget_query),
        ),
        ProductRecommendation(
            id=hashlib.md5(refurb_query.encode()).hexdigest()[:8],
            title=f"Certified Refurbished / Renewed ({cart_name})",
            estimated_price=refurb_price,
            estimated_savings=refurb_savings,
            pip_reason="Includes warranty, inspected like new, and saves over 50% compared to brand new.",
            search_query=refurb_query,
            search_url=build_search_url(refurb_query, prefer_amazon=True),
        ),
        ProductRecommendation(
            id=hashlib.md5(open_box_query.encode()).hexdigest()[:8],
            title=f"Open-Box / Clearance Deal ({cart_name})",
            estimated_price=open_box_price,
            estimated_savings=open_box_savings,
            pip_reason="Customer return with zero damage; why pay full retail for sealed cardboard?",
            search_query=open_box_query,
            search_url=build_search_url(open_box_query),
        ),
    ]


async def run_jev_recommender(payload: RecommendationsRequest) -> RecommendationsResponse:
    """Runs the TypeSafe Jev product recommendation pipeline."""
    # Extract readable item names
    item_names = []
    for it in payload.items:
        if isinstance(it, str):
            item_names.append(it)
        elif hasattr(it, "name"):
            item_names.append(it.name)

    items_str = ", ".join(item_names) if item_names else "items in cart"
    total_cost = payload.total_cost if payload.total_cost > 0 else 50.0

    settings = get_settings()
    api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""
            You are the Jev Shopping Decision Recommender engine for Nook (Pip the Squirrel).
            The shopper is checking out:
            - Product(s): {items_str}
            - Cart Total: ${total_cost:.2f}
            - Store Domain: {payload.store_domain}

            Analyze this purchase and propose exactly 2 to 3 cheaper or significantly higher-value alternative products.
            Requirements:
            1. 'title': Clear, recognizable product or model alternative (e.g. 'Refurbished Sony WH-1000XM4', 'Anker Soundcore Space Q45').
            2. 'estimated_price': Realistic market price strictly LOWER than ${total_cost:.2f}.
            3. 'pip_reason': Cheeky, supportive squirrel explanation (1 sentence) highlighting why it's a smart swap.
            4. 'search_query': A clean, deterministic search keyword query to find this exact deal online (e.g. 'anker soundcore space q45 refurbished').
            """

            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=JevPipelineOutput,
                    temperature=0.2,
                ),
            )

            parsed = JevPipelineOutput.model_validate_json(response.text)
            recs = []
            for alt in parsed.alternatives:
                est_price = min(alt.estimated_price, total_cost * 0.95)
                savings = max(1.0, round(total_cost - est_price, 2))
                rec_id = hashlib.md5(alt.search_query.encode()).hexdigest()[:8]
                recs.append(
                    ProductRecommendation(
                        id=rec_id,
                        title=alt.title,
                        estimated_price=round(est_price, 2),
                        estimated_savings=savings,
                        pip_reason=alt.pip_reason,
                        search_query=alt.search_query,
                        search_url=build_search_url(alt.search_query),
                    )
                )

            if recs:
                return RecommendationsResponse(
                    recommendations=recs,
                    summary=parsed.summary or f"Pip found {len(recs)} smart alternatives saving up to ${max(r.estimated_savings for r in recs):.2f}!",
                )
        except Exception as exc:
            print(f"[Jev Recommender] Gemini pipeline exception, using heuristic fallback: {exc}")

    # Fallback if Gemini unavailable
    fallback_recs = generate_fallback_recommendations(items_str, total_cost)
    max_savings = max(r.estimated_savings for r in fallback_recs)
    return RecommendationsResponse(
        recommendations=fallback_recs,
        summary=f"Pip spotted alternative deals saving up to ${max_savings:.2f}!",
    )
