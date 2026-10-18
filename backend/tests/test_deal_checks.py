"""Deal checks with a fake in-memory database and a fake deal agent (no network)."""

import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

import app.routers.checkout as checkout_router
import app.services.deal_checks as dc
from app.core.auth import CurrentUser, get_current_user
from app.main import app

USER = "user-1"
SESSION = str(uuid4())
NOW = lambda: datetime.now(timezone.utc)  # noqa: E731


class FakeDB:
    def __init__(self):
        self.sessions = {SESSION: {"id": SESSION, "store": "Best Buy", "cart_total": 499.98, "currency": "USD",
                                   "reason_summary": "Needs headphones for daily work calls", "category": "electronics",
                                   "page_url": "https://www.bestbuy.com/checkout/c/standard", "item_name": "Sony headphones",
                                   "items": [{"name": "USB-C cable", "price": "19.99"}, {"name": "Sony WH-1000XM5", "price": "399.99"},
                                             {"name": "Case", "price": "79.99"}, {"name": "Stickers", "price": "0.00"}, {"name": "Sony WH-1000XM5", "price": "399.99"}]}}
        self.checks: dict[str, dict] = {}

    def get_owned_session(self, user_id, session_id):
        from app.services.supabase import SupabaseAPIError
        s = self.sessions.get(str(session_id))
        if not s or user_id != USER:
            raise SupabaseAPIError(404, "P0002", "Checkout session not found")
        return s

    def insert_deal_checks(self, rows):
        out = []
        for r in rows:
            key = (r["session_id"], r["trigger"], r["item_name"])
            if any((c["session_id"], c["trigger"], c["item_name"]) == key for c in self.checks.values()):
                continue
            row = {"id": str(uuid4()), "status": "pending", "result": None, "seen_at": None, "started_at": None, **r}
            self.checks[row["id"]] = row
            out.append(row)
        return out

    def list_deal_checks(self, user_id, session_id=None, limit=50):
        return [c for c in self.checks.values() if c["user_id"] == user_id and (session_id is None or c["session_id"] == str(session_id))]

    def get_deal_check(self, user_id, check_id):
        from app.services.supabase import SupabaseAPIError
        c = self.checks.get(str(check_id))
        if not c or c["user_id"] != user_id:
            raise SupabaseAPIError(404, "P0002", "Deal check not found")
        return c

    def claim_deal_check(self, user_id, check_id, now_iso, stale_before_iso):
        c = self.checks[str(check_id)]
        if c["due_at"] > now_iso or c["status"] in ("done", "running"):
            return None
        c.update(status="running", started_at=now_iso)
        return c

    def update_deal_check(self, user_id, check_id, patch):
        self.checks[str(check_id)].update(patch)


RESULT = {"verdict": "overpriced", "verdict_reason": "Cheaper at Target.", "current_total": 399.99, "best_total": 347.99, "max_savings": 52.0,
          "acorns": 52, "offers": [{"seller": "Target", "price": 347.99, "shipping": 0, "total": 347.99, "savings": 52.0, "link": "https://t/1",
                                    "condition": "new", "match_confidence": 0.9, "reason": "Same model"}], "coupons": [], "cached": False}


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    for name in ("get_owned_session", "insert_deal_checks", "list_deal_checks", "get_deal_check", "claim_deal_check", "update_deal_check"):
        monkeypatch.setattr(dc, name, getattr(fake, name))
        if hasattr(__import__("app.routers.deal_checks", fromlist=["x"]), name):
            monkeypatch.setattr(f"app.routers.deal_checks.{name}", getattr(fake, name))
    hunted = []

    async def fake_hunt(req):
        hunted.append((req.title, req.price, req.domain))
        fake.needs = getattr(fake, "needs", []) + [(req.need, req.category)]
        yield {"event": "step", "data": {"message": f"Searching for {req.title}"}}
        yield {"event": "result", "data": RESULT}

    monkeypatch.setattr(dc, "hunt", fake_hunt)
    fake.hunted = hunted
    return fake


@pytest.fixture
def api():
    from fastapi.testclient import TestClient
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=USER, claims={})
    yield TestClient(app)
    app.dependency_overrides.pop(get_current_user, None)


def test_select_items_top_three_priced_unique():
    items = dc.select_items(FakeDB().sessions[SESSION])
    assert [i["name"] for i in items] == ["Sony WH-1000XM5", "Case", "USB-C cable"]


def test_select_items_falls_back_to_cart_total_and_pips_item():
    assert dc.select_items({"items": [{"name": "Mystery box"}], "cart_total": 42}) == [{"name": "Mystery box", "price": 42.0}]
    assert dc.select_items({"items": [], "cart_total": 603.21, "item_name": "Noise cancelling headphones"}) == [{"name": "Noise cancelling headphones", "price": 603.21}]
    assert dc.select_items({"items": [], "cart_total": 0, "item_name": "x"}) == []


def test_schedule_buy_now_and_wait_tomorrow_without_duplicates(db):
    buy = dc.schedule(USER, SESSION, "buy")
    wait = dc.schedule(USER, SESSION, "wait")
    dc.schedule(USER, SESSION, "wait")  # again: skipped
    assert len(buy) == 3 and len(wait) == 3 and len(db.checks) == 6
    due_buy = datetime.fromisoformat(buy[0]["due_at"])
    due_wait = datetime.fromisoformat(wait[0]["due_at"])
    assert due_buy <= NOW() and timedelta(hours=23, minutes=59) < due_wait - NOW() <= timedelta(hours=24)


def test_run_streams_and_stores_then_replays(db, api):
    check = dc.schedule(USER, SESSION, "buy")[0]
    with api.stream("POST", f"/api/deal-checks/{check['id']}/run") as r:
        text = "".join(r.iter_text())
    assert "event: step" in text and "event: result" in text
    assert db.checks[check["id"]]["status"] == "done" and db.checks[check["id"]]["result"]["max_savings"] == 52.0
    assert db.hunted == [("Sony WH-1000XM5", 399.99, "www.bestbuy.com")]
    assert db.needs == [("Needs headphones for daily work calls", "electronics")]  # the conversation's reason steers similar picks
    with api.stream("POST", f"/api/deal-checks/{check['id']}/run") as r:  # already done: replay, no new hunt
        assert "event: result" in "".join(r.iter_text())
    assert len(db.hunted) == 1


def test_wait_checks_refuse_to_run_early(db, api):
    check = dc.schedule(USER, SESSION, "wait")[0]
    with api.stream("POST", f"/api/deal-checks/{check['id']}/run") as r:
        text = "".join(r.iter_text())
    assert "event: error" in text and "when your wait is over" in text and not db.hunted


def test_list_marks_due_and_seen_hides(db, api):
    dc.schedule(USER, SESSION, "wait")
    check = dc.schedule(USER, SESSION, "buy")[0]
    rows = api.get("/api/deal-checks").json()["checks"]
    assert {r["trigger"]: r["due"] for r in rows} == {"wait": False, "buy": True}
    assert api.post(f"/api/deal-checks/{check['id']}/seen").json()["seen"] is True
    assert db.checks[check["id"]]["seen_at"]


def test_other_users_cant_touch_checks(db, api):
    check = dc.schedule(USER, SESSION, "buy")[0]
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id="someone-else", claims={})
    assert api.post(f"/api/deal-checks/{check['id']}/run").status_code == 404
    assert api.post("/api/deal-checks", json={"session_id": SESSION, "trigger": "buy"}).status_code == 404


def test_choosing_wait_schedules_checks(db, api, monkeypatch):
    monkeypatch.setattr(checkout_router, "fill_session_details", lambda *a, **k: {"category": "electronics", "item_name": "Sony"})
    monkeypatch.setattr(checkout_router, "record_checkout_decision", lambda u, s, d: {"decision": d, "acorns_awarded": 10})
    monkeypatch.setattr(checkout_router, "tag_decision", lambda *a, **k: None)
    body = api.post(f"/api/checkout/{SESSION}/decision", json={"decision": "save"}).json()
    assert body["deal_checks_scheduled"] == 3
    assert {c["trigger"] for c in db.checks.values()} == {"wait"}
    body = api.post(f"/api/checkout/{SESSION}/decision", json={"decision": "buy"}).json()
    assert body["deal_checks_scheduled"] == 0
