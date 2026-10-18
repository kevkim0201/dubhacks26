"""Turns the model's answer into a trustworthy DealResponse. Code decides; the model only
points at offers (by id) and explains. Anything it can't back with a tool result is dropped."""

import json
import math
import re

from .context import AgentContext
from .models import Coupon, DealRequest, DealResponse, Offer

MIN_CONFIDENCE = 0.8
MAX_OFFERS = 5
USED_WORDS = ("used", "refurb", "renewed", "pre-owned", "open box", "second")


class ModelJSONError(ValueError):
    pass


def parse_model_json(text: str) -> dict:
    """Parses the model's final answer, tolerating ```json fences and stray prose around it."""
    if not text or not text.strip():
        raise ModelJSONError("empty response")
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I | re.M).strip()
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ModelJSONError("no JSON object found") from None
        try:
            data = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ModelJSONError(str(exc)) from exc
    if not isinstance(data, dict):
        raise ModelJSONError("expected a JSON object")
    return data


def _is_used(condition: str) -> bool:
    return any(word in (condition or "").lower() for word in USED_WORDS)


def _threshold(current_total: float) -> float:
    return max(10.0, 0.05 * current_total)


def compute_verdict(current_total: float, max_savings: float) -> str:
    if max_savings <= 0:
        return "great_deal"
    return "overpriced" if max_savings >= _threshold(current_total) else "fair"


def _money(value: float, currency: str) -> str:
    symbol = {"USD": "$", "CAD": "C$", "AUD": "A$", "GBP": "£", "EUR": "€", "JPY": "¥", "INR": "₹"}.get(currency, "")
    return f"{symbol}{value:,.2f}" if symbol else f"{value:,.2f} {currency}"


def default_reason(verdict: str, best: Offer | None, currency: str) -> str:
    if verdict == "great_deal" or best is None:
        return "I couldn't find this exact item for less anywhere I looked. Nice find!"
    shipping = " with free shipping" if best.shipping == 0 else ""
    amount = _money(best.savings, currency)
    if verdict == "overpriced":
        return f"Same item is {amount} cheaper at {best.seller}{shipping}."
    return f"Only {amount} cheaper at {best.seller}, so this price is fair."


def _coupons(ctx: AgentContext) -> list[Coupon]:
    seen, out = set(), []
    for entries in ctx.coupons.values():
        for c in entries:
            if c["code"] not in seen:
                seen.add(c["code"])
                out.append(Coupon(**{k: c[k] for k in ("code", "description", "source") if k in c}))
    return out


def build_response(req: DealRequest, picks: list[dict], ctx: AgentContext, verdict_reason: str | None = None) -> DealResponse:
    """picks: [{offer_id | link, match_confidence, reason}] from the model (or the fallback matcher)."""
    current = req.current_total
    by_link = {o["link"]: o for o in ctx.offers.values()}
    offers: dict[str, Offer] = {}
    for pick in picks:
        if not isinstance(pick, dict):
            continue
        raw = ctx.offers.get(str(pick.get("offer_id", ""))) or by_link.get(str(pick.get("link", "")))
        if raw is None or raw["link"] not in ctx.seen_links:
            continue  # the model pointed at something no tool returned
        try:
            confidence = float(pick.get("match_confidence", 0))
        except (TypeError, ValueError):
            continue
        if confidence < MIN_CONFIDENCE:
            continue
        if _is_used(raw["condition"]) and not _is_used(req.condition):
            continue  # used / refurbished only matches a used source item
        total = round(raw["price"] + raw["shipping"], 2)
        savings = round(current - total, 2)
        if savings <= 0:
            continue
        offer = Offer(
            seller=raw["seller"],
            price=raw["price"],
            shipping=raw["shipping"],
            total=total,
            savings=savings,
            link=raw["link"],
            condition=raw["condition"],
            match_confidence=round(min(confidence, 1.0), 2),
            reason=str(pick.get("reason", ""))[:200],
        )
        if raw["link"] not in offers or offers[raw["link"]].savings < savings:
            offers[raw["link"]] = offer

    ranked = sorted(offers.values(), key=lambda o: o.savings, reverse=True)[:MAX_OFFERS]
    max_savings = ranked[0].savings if ranked else 0.0
    verdict = compute_verdict(current, max_savings)
    reason = (verdict_reason or "").strip()
    if verdict == "great_deal" or not reason or len(reason) > 200:
        reason = default_reason(verdict, ranked[0] if ranked else None, req.currency)
    return DealResponse(
        verdict=verdict,
        verdict_reason=reason,
        current_total=current,
        best_total=ranked[0].total if ranked else current,
        max_savings=max_savings,
        acorns=math.floor(max_savings),
        offers=ranked,
        coupons=_coupons(ctx),
    )


def unavailable_response(req: DealRequest, why: str, ctx: AgentContext | None = None) -> DealResponse:
    """We couldn't check (search/model down). Never claim a great deal we didn't verify."""
    return DealResponse(
        verdict="fair",
        verdict_reason=f"I couldn't compare prices right now ({why}), so I can't say if this is a good deal.",
        current_total=req.current_total,
        best_total=req.current_total,
        max_savings=0.0,
        acorns=0,
        offers=[],
        coupons=_coupons(ctx) if ctx else [],
    )


# ---------- fallback matcher (used when the model times out or errors) ----------

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOP = {"the", "and", "with", "for", "new", "in", "of", "a", "an", "-", "by"}


def _tokens(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if t not in _STOP}


def _model_numbers(tokens: set[str]) -> set[str]:
    return {t for t in tokens if any(c.isdigit() for c in t) and any(c.isalpha() for c in t)}


def heuristic_picks(req: DealRequest, ctx: AgentContext) -> list[dict]:
    """Conservative title matching: needs the same model numbers and strong word overlap."""
    source = _tokens(f"{req.brand or ''} {req.title}")
    models = _model_numbers(source)
    picks = []
    for offer_id, raw in ctx.offers.items():
        cand = _tokens(raw["title"])
        if models and not models <= cand:
            continue
        overlap = len(source & cand) / max(1, len(source | cand))
        confidence = min(0.95, overlap + (0.3 if models else 0))
        picks.append({"offer_id": offer_id, "match_confidence": round(confidence, 2), "reason": "Title and model number match"})
    return picks
