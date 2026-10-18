import json

import pytest

from app.core.config import get_settings
from app.services.deal_agent import cache, demo


@pytest.fixture(autouse=True)
def demo_mode(monkeypatch):
    cache.clear()
    monkeypatch.setattr(get_settings(), "demo_mode", True)
    monkeypatch.setattr(demo, "STEP_DELAY_S", 0)
    yield
    cache.clear()


HEADPHONES = {"title": "EchoPulse Sport Headphones", "price": 89.0, "url": "http://localhost:8000/demo/index.html#prod-headphones"}


def test_post_deals_demo_and_cache(client):
    r = client.post("/api/deals", json=HEADPHONES)
    assert r.status_code == 200
    body = r.json()
    assert body["verdict"] == "overpriced" and body["offers"][0]["seller"] == "Target"
    assert body["max_savings"] == 14.01 and body["acorns"] == 14 and body["cached"] is False
    assert all(o["condition"] == "new" for o in body["offers"])  # renewed listing dropped
    assert body["coupons"][0]["code"] == "NOOK10"
    assert client.post("/api/deals", json={**HEADPHONES, "url": "http://www.localhost:8000/demo/index.html/?utm_source=nook#prod-headphones"}).json()["cached"] is True


@pytest.mark.parametrize("title,verdict", [("CloudKnit Heavyweight Hoodie", "fair"), ("AeroStride Marathon Sneakers", "great_deal"), ("Thermal Hydro Flask 32oz", "fair")])  # flask: $8.05 saved is under the $10 floor
def test_demo_fixtures_cover_each_verdict(client, title, verdict):
    price = {"CloudKnit Heavyweight Hoodie": 65.0, "AeroStride Marathon Sneakers": 120.0, "Thermal Hydro Flask 32oz": 38.0}[title]
    assert client.post("/api/deals", json={"title": title, "price": price, "url": f"https://x/{title}"}).json()["verdict"] == verdict


def test_missing_price_is_a_clear_422(client):
    r = client.post("/api/deals", json={"title": "Thing", "url": "https://x/y"})
    assert r.status_code == 422 and "price is required" in r.json()["detail"]


def test_stream_get_emits_steps_then_result(client):
    with client.stream("GET", "/api/deals/stream", params={"payload": json.dumps(HEADPHONES)}) as r:
        assert r.headers["content-type"].startswith("text/event-stream")
        text = "".join(r.iter_text())
    events = [block.split("\n")[0].removeprefix("event: ") for block in text.strip().split("\n\n")]
    assert events[0] == "step" and events[-1] == "result" and events.count("result") == 1


def test_stream_post_works_too(client):
    with client.stream("POST", "/api/deals/stream", json=HEADPHONES) as r:
        text = "".join(r.iter_text())
    assert "event: result" in text
