from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.rewards.settle import Timing

HOODIE = {"name": "Trailhead Hoodie", "price": 64.0}
HEADPHONES = {"name": "Gym Headphones", "price": 89.99}


def decide(client, session_id, kind):
    return client.post("/api/checkout/decision", json={"session_id": session_id, "decision": kind})


def purchase(client, *, ref="PK-1", item=HOODIE, session_id=None, shop="pinecone.shop"):
    return client.post("/api/purchases", json={
        "order_ref": ref, "store": shop, "items": [item], "total": item["price"], "session_id": session_id,
    })


def state(client):
    res = client.get("/api/user/state")
    assert res.status_code == 200
    return res.json()


def test_routes_require_a_signed_in_user():
    plain = TestClient(app)  # no auth override
    assert plain.get("/api/user/state").status_code == 401
    assert plain.post("/api/checkout/decision",
                      json={"session_id": str(uuid4()), "decision": "buy"}).status_code == 401


def test_demo_script_skip_then_justified_buy_evolves_the_squirrel(client, store, clock, new_session):
    # Seeded just under Forager, as in the demo script.
    store.award("user-1", 980)

    skip = decide(client, new_session(reason="Already owns a similar hoodie"), "skip")
    assert skip.status_code == 201
    body = skip.json()
    assert (body["status"], body["acorns_awarded"]) == ("pending", 72)
    assert (body["total_earned"], body["pending_acorns"], body["tier_up"]) == (980, 72, False)

    clock.advance(minutes=2)
    buy = decide(client, new_session(**HEADPHONES, reason="Old ones broke"), "buy").json()
    assert (buy["status"], buy["acorns_awarded"]) == ("locked", 20)
    assert (buy["total_earned"], buy["tier"], buy["tier_up"]) == (1000, "Forager", True)
    assert buy["pending_acorns"] == 72  # the skip is still waiting

    history = state(client)["recent_decisions"]
    assert [d["reason_summary"] for d in history] == ["Old ones broke", "Already owns a similar hoodie"]


def test_skip_pays_out_after_the_wait_and_counts_as_money_kept(client, clock, new_session):
    decide(client, new_session(), "skip")
    clock.advance(seconds=Timing().skip_lock.total_seconds())
    s = state(client)
    assert s["recent_decisions"][0]["status"] == "locked"
    assert (s["total_earned"], s["balance"], s["pending_acorns"], s["money_kept"]) == (72, 72, 0, 64.0)


def test_buying_a_skipped_item_cancels_the_skip(client, clock, new_session):
    decide(client, new_session(), "skip")
    clock.advance(days=2)
    res = purchase(client, item={"name": "Trailhead Hoodie - Grey, M", "price": 64.0}).json()
    assert [c["kind"] for c in res["changes"]] == ["skip_cancelled"]
    clock.advance(days=7)
    assert state(client)["total_earned"] == 0


def test_save_for_later_then_buy_after_the_wait_earns_the_bonus(client, clock, new_session):
    saved = decide(client, new_session(), "save").json()
    assert (saved["status"], saved["acorns_awarded"], saved["balance"]) == ("locked", 30, 30)
    assert [i["item_name"] for i in state(client)["saved_items"]] == ["Trailhead Hoodie"]

    clock.advance(hours=48)
    res = purchase(client).json()
    assert [(c["kind"], c["acorns"]) for c in res["changes"]] == [("saved_bought", 20)]
    assert res["balance"] == 50
    assert state(client)["saved_items"] == []


def test_dropping_a_saved_item(client, user_id, new_session):
    decide(client, new_session(), "save")
    [item] = state(client)["saved_items"]

    user_id["id"] = "someone-else"
    assert client.post(f"/api/saved-items/{item['id']}/drop").status_code == 404

    user_id["id"] = "user-1"
    res = client.post(f"/api/saved-items/{item['id']}/drop")
    assert (res.status_code, res.json()["status"]) == (200, "dropped")
    assert client.post(f"/api/saved-items/{item['id']}/drop").status_code == 409
    assert client.post("/api/saved-items/nope/drop").status_code == 404


def test_unknown_or_someone_elses_session_is_404(client, new_session):
    assert decide(client, str(uuid4()), "buy").status_code == 404
    assert decide(client, new_session(user="someone-else"), "buy").status_code == 404


def test_one_decision_per_checkout_session(client, new_session):
    session_id = new_session()
    assert decide(client, session_id, "save").status_code == 201
    assert decide(client, session_id, "skip").status_code == 409
    assert state(client)["balance"] == 30


def test_reporting_the_same_order_twice_changes_nothing(client, clock, new_session):
    decide(client, new_session(), "save")
    clock.advance(hours=48)
    first = purchase(client).json()
    second = purchase(client).json()
    assert (first["duplicate"], second["duplicate"]) == (False, True)
    assert second["changes"] == []
    assert second["balance"] == first["balance"] == 50


def test_purchase_ignores_a_session_id_that_isnt_yours(client, store, new_session):
    other = new_session(user="someone-else")
    res = purchase(client, session_id=other)
    assert res.status_code == 200
    event = store.get_purchase_event_by_ref("user-1", "PK-1")
    assert event.session_id is None


def test_users_only_see_their_own_acorns(client, user_id, new_session):
    decide(client, new_session(), "save")
    user_id["id"] = "someone-else"
    s = state(client)
    assert (s["balance"], s["recent_decisions"]) == (0, [])


def test_bad_requests_are_rejected(client, new_session):
    good = {"session_id": new_session(), "decision": "buy"}
    for bad in (
        {**good, "decision": "maybe"},
        {**good, "session_id": "not-a-uuid"},
        {"decision": "buy"},
    ):
        assert client.post("/api/checkout/decision", json=bad).status_code == 422
    assert client.post("/api/purchases", json={"order_ref": "x", "store": "s", "items": [], "total": 1}).status_code == 422
