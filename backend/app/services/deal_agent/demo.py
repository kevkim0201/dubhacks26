"""DEMO_MODE: canned hunts for a few demo products, with the same verification as live runs.
Lets the demo work if venue Wi-Fi dies or an API quota runs out."""

import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path

from .cache import normalize_url
from .context import AgentContext
from .models import DealRequest
from .verify import build_response, unavailable_response

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "demo"
STEP_DELAY_S = 0.6


def _fixtures() -> list[dict]:
    return [json.loads(p.read_text()) for p in sorted(FIXTURES.glob("*.json"))]


def find_fixture(req: DealRequest) -> dict | None:
    url = normalize_url(req.url)
    title = req.title.lower()
    for fx in _fixtures():
        match = fx["match"]
        if url in {normalize_url(u) for u in match.get("urls", [])}:
            return fx
        if any(t.lower() in title for t in match.get("titles", [])):
            return fx
    return None


async def run_demo(req: DealRequest) -> AsyncIterator[dict]:
    fx = find_fixture(req)
    if fx is None:
        yield {"event": "step", "data": {"message": "I only know a few products in demo mode..."}}
        yield {"event": "result", "data": unavailable_response(req, "demo mode has no data for this product").model_dump()}
        return
    for message in fx["steps"]:
        yield {"event": "step", "data": {"message": message}}
        await asyncio.sleep(STEP_DELAY_S)
    ctx = AgentContext(currency=req.currency)
    picks = []
    for raw in fx["offers"]:
        offer_id = ctx.remember({k: raw[k] for k in ("title", "seller", "price", "shipping", "condition", "link")})
        picks.append({"offer_id": offer_id, "match_confidence": raw["match_confidence"], "reason": raw["reason"]})
    ctx.coupons["demo"] = fx.get("coupons", [])
    response = build_response(req, picks, ctx, fx.get("verdict_reason"))
    yield {"event": "result", "data": response.model_dump()}
