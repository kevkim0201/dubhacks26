import pytest

from app.services.deal_agent.context import AgentContext
from app.services.deal_agent.models import DealRequest
from app.services.deal_agent.tools.search_offers import parse_result, parse_shipping
from app.services.deal_agent.verify import (
    ModelJSONError, build_response, compute_verdict, heuristic_picks, parse_model_json, unavailable_response,
)

REQ = DealRequest(title="Sony WH-1000XM5 Wireless Headphones - Black", price=399.99, url="https://bestbuy.com/p/1", brand="Sony")


def ctx_with(*offers):
    ctx = AgentContext()
    ids = [ctx.remember({"title": "Sony WH-1000XM5", "seller": "S", "price": 0, "shipping": 0, "condition": "new", "link": f"https://s/{i}", **o}) for i, o in enumerate(offers)]
    return ctx, ids


def test_drops_links_no_tool_returned():
    ctx, [a] = ctx_with({"price": 347.99})
    r = build_response(REQ, [{"offer_id": a, "match_confidence": 0.9}, {"link": "https://made-up.example/deal", "match_confidence": 0.99}, {"offer_id": "o99", "match_confidence": 0.99}], ctx)
    assert [o.link for o in r.offers] == ["https://s/0"]


def test_drops_low_confidence_and_used_items():
    ctx, [a, b, c] = ctx_with({"price": 300}, {"price": 310, "condition": "refurbished"}, {"price": 320})
    r = build_response(REQ, [{"offer_id": a, "match_confidence": 0.79}, {"offer_id": b, "match_confidence": 0.95}, {"offer_id": c, "match_confidence": 0.8}], ctx)
    assert [o.price for o in r.offers] == [320]


def test_math_includes_shipping_and_drops_non_savings():
    ctx, [a, b] = ctx_with({"price": 380, "shipping": 25}, {"price": 340, "shipping": 7.99})
    r = build_response(REQ, [{"offer_id": a, "match_confidence": 0.9}, {"offer_id": b, "match_confidence": 0.9}], ctx)
    assert len(r.offers) == 1  # 380 + 25 = 405 is not cheaper than 399.99
    best = r.offers[0]
    assert (best.total, best.savings) == (347.99, 52.0)
    assert (r.best_total, r.max_savings, r.acorns, r.verdict) == (347.99, 52.0, 52, "overpriced")


def test_sorts_by_savings_and_keeps_top_five():
    ctx, ids = ctx_with(*[{"price": 390 - i * 10} for i in range(7)])
    r = build_response(REQ, [{"offer_id": i, "match_confidence": 0.9} for i in ids], ctx)
    assert [o.price for o in r.offers] == [330, 340, 350, 360, 370]


@pytest.mark.parametrize("current,savings,verdict", [
    (399.99, 0, "great_deal"), (399.99, 19.99, "fair"), (399.99, 20.0, "overpriced"),  # 5% of 399.99 = 20.00
    (50.0, 9.99, "fair"), (50.0, 10.0, "overpriced"),  # $10 floor beats 5% on cheap items
])
def test_verdict_thresholds(current, savings, verdict):
    assert compute_verdict(current, savings) == verdict


def test_great_deal_when_nothing_cheaper():
    r = build_response(REQ, [], AgentContext())
    assert (r.verdict, r.offers, r.max_savings, r.acorns) == ("great_deal", [], 0.0, 0)


def test_unavailable_is_fair_not_great():
    r = unavailable_response(REQ, "shopping search is unavailable")
    assert r.verdict == "fair" and "couldn't compare" in r.verdict_reason


@pytest.mark.parametrize("text", [
    '{"offers": [], "verdict_reason": "ok"}',
    '```json\n{"offers": [], "verdict_reason": "ok"}\n```',
    'Here you go:\n```\n{"offers": [], "verdict_reason": "ok"}\n```\nThanks!',
])
def test_parse_model_json(text):
    assert parse_model_json(text) == {"offers": [], "verdict_reason": "ok"}


def test_parse_model_json_rejects_garbage():
    with pytest.raises(ModelJSONError):
        parse_model_json("no json here")


def test_shipping_and_currency_parsing():
    assert (parse_shipping("Free delivery"), parse_shipping("$5.99 delivery"), parse_shipping("In stock")) == (0.0, 5.99, None)
    assert parse_result({"extracted_price": 300, "price": "£300", "link": "x"}, "USD") is None
    assert parse_result({"extracted_price": 10, "price": "$10", "source": "T", "link": "x", "second_hand_condition": "used"}, "USD")["condition"] == "used"


def test_heuristic_requires_model_number():
    ctx, [same, case] = ctx_with({"title": "Sony WH-1000XM5 Wireless Headphones Black", "price": 330}, {"title": "Sony WH-1000XM4 Headphones", "price": 200})
    picks = {p["offer_id"]: p["match_confidence"] for p in heuristic_picks(REQ, ctx)}
    assert same in picks and picks[same] >= 0.8 and case not in picks


# ---------- similar picks (alternatives) ----------

def test_alternatives_rules():
    ctx, ids = ctx_with(
        {"title": "Sony WH-1000XM5", "price": 347.99},                         # exact match
        {"title": "Soundcore Space Q45", "price": 89.99},                      # good alternative
        {"title": "Bose QC45", "price": 279.0},                                # good alternative, better fit
        {"title": "JBL Tune 510", "price": 39.99},                             # weak fit
        {"title": "Sennheiser Momentum 4 (Refurbished)", "price": 220, "condition": "refurbished"},
        {"title": "Apple AirPods Max", "price": 549.0},                        # not cheaper
    )
    exact, q45, qc45, jbl, refurb, airpods = ids
    r = build_response(
        REQ,
        [{"offer_id": exact, "match_confidence": 0.95}],
        ctx,
        alternative_picks=[
            {"offer_id": q45, "fit_score": 0.8, "why": "Also noise cancelling", "tradeoff": "Plastic build"},
            {"offer_id": qc45, "fit_score": 0.9, "why": "Great ANC for calls", "tradeoff": "Older model"},
            {"offer_id": jbl, "fit_score": 0.5},
            {"offer_id": refurb, "fit_score": 0.95},
            {"offer_id": airpods, "fit_score": 0.95},
            {"offer_id": exact, "fit_score": 0.99},          # already an exact match
            {"offer_id": "o404", "fit_score": 0.99},          # no tool returned it
        ],
    )
    assert [a.title for a in r.alternatives] == ["Bose QC45", "Soundcore Space Q45"]  # best fit first
    assert r.alternatives[1].why == "Also noise cancelling" and r.alternatives[1].tradeoff == "Plastic build"
    assert r.alternatives[0].savings == round(399.99 - 279.0, 2)
    # Alternatives never change the verdict or acorns, which are about the exact item.
    assert (r.verdict, r.max_savings, r.acorns) == ("overpriced", 52.0, 52)


def test_alternatives_capped_at_three():
    ctx, ids = ctx_with(*[{"title": f"Alt {i}", "price": 100 + i} for i in range(5)])
    r = build_response(REQ, [], ctx, alternative_picks=[{"offer_id": i, "fit_score": 0.8} for i in ids])
    assert len(r.alternatives) == 3 and r.verdict == "great_deal"
