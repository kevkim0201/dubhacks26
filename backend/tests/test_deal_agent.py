"""Agent loop with fake Gemini and SerpAPI (no network)."""

import asyncio
from types import SimpleNamespace

from google.genai import types

import app.services.deal_agent.agent as agent
from app.core.config import get_settings
from app.services.deal_agent.models import DealRequest

REQ = DealRequest(title="Sony WH-1000XM5 Wireless Headphones - Black", price=399.99, url="https://www.bestbuy.com/site/sony/123", brand="Sony")


def call(name, **args):
    fc = types.FunctionCall(name=name, args=args)
    return SimpleNamespace(function_calls=[fc], text=None, candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(function_call=fc)]))])


def final(text):
    return SimpleNamespace(function_calls=None, text=text, candidates=[])


class FakeGemini:
    def __init__(self, script):
        self.script = list(script)
        outer = self

        class Models:
            async def generate_content(self, **kw):
                item = outer.script.pop(0)
                if isinstance(item, Exception):
                    raise item
                if callable(item):
                    return await item()
                return item

        self.aio = SimpleNamespace(models=Models())


async def fake_search(ctx, query, limit=10):
    ctx.queries.append(query)
    rows = [("Sony WH-1000XM5 Black", "Target", 347.99, "new"), ("Sony WH-1000XM5 (Renewed)", "Amazon", 248.0, "refurbished"), ("Case for XM5", "Etsy", 19.0, "new")]
    out = []
    for i, (title, seller, price, cond) in enumerate(rows):
        oid = ctx.remember({"title": title, "seller": seller, "price": price, "shipping": 0.0, "condition": cond, "link": f"https://shop/{i}"})
        out.append({"offer_id": oid, "title": title, "seller": seller, "price": price, "shipping": 0.0, "shipping_known": True, "condition": cond})
    return out


def run(monkeypatch, script):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "test")
    monkeypatch.setattr(agent, "search_offers", fake_search)
    monkeypatch.setattr(agent.genai, "Client", lambda api_key: FakeGemini(script))

    async def collect():
        return [e async for e in agent.run_deal_agent(REQ)]

    return asyncio.run(collect())


def test_full_hunt_streams_steps_and_verified_result(monkeypatch):
    events = run(monkeypatch, [
        call("search_offers", query="Sony WH-1000XM5 black"),
        call("check_coupons", domain="bestbuy.com"),
        # o2 is refurbished, o3 is a case, o9 doesn't exist: all must be dropped by code.
        final('```json\n{"offers": [{"offer_id": "o1", "match_confidence": 0.95, "reason": "Same model and color"},'
              '{"offer_id": "o2", "match_confidence": 0.9}, {"offer_id": "o3", "match_confidence": 0.3}, {"offer_id": "o9", "match_confidence": 0.99}],'
              '"verdict_reason": "Same model is $52 cheaper at Target with free shipping."}\n```'),
    ])
    kinds = [e["event"] for e in events]
    assert kinds[0] == "step" and kinds[-1] == "result" and kinds.count("result") == 1
    messages = [e["data"]["message"] for e in events if e["event"] == "step"]
    assert any("Searching Google Shopping" in m for m in messages)
    assert any("Skipping 1 used or refurbished listing" in m for m in messages)
    assert not any("{" in m for m in messages)  # never raw tool JSON
    res = events[-1]["data"]
    assert [o["seller"] for o in res["offers"]] == ["Target"]
    assert (res["verdict"], res["max_savings"], res["acorns"]) == ("overpriced", 52.0, 52)


def test_gemini_error_without_offers_is_a_graceful_fair(monkeypatch):
    from google.genai import errors
    events = run(monkeypatch, [errors.APIError(500, {"error": {"message": "boom"}})])
    res = events[-1]["data"]
    assert events[-1]["event"] == "result" and res["verdict"] == "fair" and res["offers"] == []


def test_timeout_uses_offers_found_so_far(monkeypatch):
    monkeypatch.setattr(agent, "DEADLINE_S", 0.3)
    monkeypatch.setattr(agent, "ANSWER_RESERVE_S", 0)

    async def slow():
        await asyncio.sleep(5)

    events = run(monkeypatch, [call("search_offers", query="Sony WH-1000XM5"), slow])
    res = events[-1]["data"]
    assert events[-1]["event"] == "result"
    assert [o["seller"] for o in res["offers"]] == ["Target"]  # heuristic matcher kept only the true match


def test_parallel_tool_calls_in_one_turn(monkeypatch):
    both = SimpleNamespace(
        function_calls=[types.FunctionCall(name="search_offers", args={"query": "Sony WH-1000XM5"}), types.FunctionCall(name="check_coupons", args={"domain": "bestbuy.com"})],
        text=None,
        candidates=[SimpleNamespace(content=types.Content(role="model", parts=[types.Part(text="calling tools")]))],
    )
    events = run(monkeypatch, [both, final('{"offers": [{"offer_id": "o1", "match_confidence": 0.9}], "verdict_reason": "Cheaper at Target."}')])
    messages = [e["data"]["message"] for e in events if e["event"] == "step"]
    assert messages.index("Checking my coupon stash for bestbuy.com") < messages.index("Found 3 listings to sniff through")
    assert events[-1]["data"]["offers"][0]["seller"] == "Target"


def test_missing_gemini_key(monkeypatch):
    monkeypatch.setattr(get_settings(), "gemini_api_key", "")
    events = asyncio.run((lambda: _collect(agent.run_deal_agent(REQ)))())
    assert events[-1]["data"]["verdict"] == "fair"


async def _collect(gen):
    return [e async for e in gen]
