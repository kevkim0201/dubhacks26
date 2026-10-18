"""SerpAPI Google Shopping search. Returns compact offers the model can reason about."""

import re

import httpx

from app.core.config import get_settings

from ..context import AgentContext

SERPAPI_URL = "https://serpapi.com/search.json"
SYMBOLS = {"$": "USD", "US$": "USD", "C$": "CAD", "CA$": "CAD", "A$": "AUD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR"}
COUNTRY = {"USD": "us", "CAD": "ca", "GBP": "uk", "EUR": "de", "AUD": "au", "JPY": "jp", "INR": "in"}
MONEY_RE = re.compile(r"(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)")


class SearchUnavailable(RuntimeError):
    """SerpAPI isn't configured, is out of quota, or errored."""


def _currency_of(price_text: str | None) -> str | None:
    text = (price_text or "").strip()
    for symbol in sorted(SYMBOLS, key=len, reverse=True):
        if text.startswith(symbol) or text.endswith(symbol):
            return SYMBOLS[symbol]
    return None


def parse_shipping(delivery: str | None) -> float | None:
    """'Free delivery' -> 0, '$5.99 delivery' -> 5.99, unknown -> None."""
    text = (delivery or "").lower()
    if not text:
        return None
    if "free" in text:
        return 0.0
    match = MONEY_RE.search(text.replace(",", ""))
    return float(match.group(1)) if match and ("ship" in text or "deliver" in text) else None


def parse_result(raw: dict, currency: str) -> dict | None:
    """One SerpAPI shopping result -> our offer shape, or None if unusable."""
    price = raw.get("extracted_price")
    link = raw.get("link") or raw.get("product_link")
    if price is None or not link:
        return None
    found_currency = _currency_of(raw.get("price"))
    if found_currency and found_currency != currency:
        return None  # never compare across currencies
    condition = (raw.get("second_hand_condition") or "new").lower()
    shipping = parse_shipping(raw.get("delivery"))
    return {
        "title": raw.get("title", "")[:200],
        "seller": raw.get("source") or "Unknown seller",
        "price": round(float(price), 2),
        "shipping": shipping if shipping is not None else 0.0,
        "shipping_known": shipping is not None,
        "condition": condition,
        "link": link,
        "thumbnail": raw.get("thumbnail"),
    }


async def search_offers(ctx: AgentContext, query: str, limit: int = 10) -> list[dict]:
    """Searches Google Shopping and records every result in ctx (ids + seen links)."""
    settings = get_settings()
    if not settings.serpapi_key:
        raise SearchUnavailable("SERPAPI_KEY is not configured")
    params = {
        "engine": "google_shopping",
        "q": query,
        "gl": COUNTRY.get(ctx.currency, "us"),
        "hl": "en",
        "num": limit,
        "api_key": settings.serpapi_key,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(SERPAPI_URL, params=params)
    except httpx.HTTPError as exc:
        raise SearchUnavailable(f"SerpAPI request failed: {exc}") from exc
    if response.status_code != 200:
        raise SearchUnavailable(f"SerpAPI returned {response.status_code}")
    data = response.json()
    if data.get("error"):
        raise SearchUnavailable(str(data["error"]))

    ctx.queries.append(query)
    results = []
    for raw in data.get("shopping_results", [])[:limit]:
        offer = parse_result(raw, ctx.currency)
        if offer:
            offer_id = ctx.remember(offer)
            results.append({"offer_id": offer_id, **{k: offer[k] for k in ("title", "seller", "price", "shipping", "shipping_known", "condition")}})
    return results
