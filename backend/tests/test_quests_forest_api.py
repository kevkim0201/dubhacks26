from datetime import timedelta

from fastapi.testclient import TestClient

from app.main import app
from app.services import quests as rules


def week(client):
    res = client.get("/api/quests")
    assert res.status_code == 200
    return res.json()


def quest_of(data, quest_type):
    return next(q for q in data["quests"] if q["quest_type"] == quest_type)


def test_routes_require_sign_in():
    plain = TestClient(app)
    for method, path in [("get", "/api/quests"), ("get", "/api/forest"), ("post", "/api/forest/plant"),
                         ("get", "/api/forest/leaderboard")]:
        assert getattr(plain, method)(path).status_code == 401


# --- quests ---

def test_first_visit_creates_three_level_one_quests_once(client, fake):
    data = week(client)
    assert data["week_start"] == "2026-10-12"
    assert len(data["quests"]) == 3
    assert all(q["level"] == 1 and q["reward_acorns"] == 30 and q["progress"] == 0 for q in data["quests"])
    week(client)
    assert len(fake.quests) == 3  # a second visit doesn't add more


def test_progress_comes_from_this_weeks_decisions(client, fake, today):
    types = rules.types_for_week(today["date"])
    fake.add_decision("user-1", "skip", matched=True, cart_total="64.00")
    data = week(client)
    if "talk" in types:
        q = quest_of(data, "talk")
        assert (q["progress"], q["target"], q["complete"], q["claimable"]) == (1, 1, True, True)
    if "kept" in types:
        q = quest_of(data, "kept")
        assert (q["progress"], q["target"], q["complete"]) == (10, 10, True)  # capped at the target


def test_claiming_pays_acorns_and_xp_once(client, fake):
    fake.add_decision("user-1", "skip", matched=True, cart_total="64.00")
    quest = week(client)["quests"][0]
    res = client.post(f"/api/quests/{quest['id']}/claim")
    assert res.status_code == 200
    assert res.json()["result"]["reward_acorns"] == 30
    assert fake.profile("user-1") == {"acorn_balance": 30, "total_xp": 30, "tier": "Baby"}
    claimed = next(q for q in res.json()["quests"] if q["id"] == quest["id"])
    assert (claimed["status"], claimed["claimable"]) == ("claimed", False)

    again = client.post(f"/api/quests/{quest['id']}/claim")
    assert again.status_code == 409
    assert fake.profile("user-1")["acorn_balance"] == 30


def test_incomplete_quest_cannot_be_claimed(client, fake):
    quest = week(client)["quests"][0]
    res = client.post(f"/api/quests/{quest['id']}/claim")
    assert res.status_code == 409
    assert fake.profile("user-1")["acorn_balance"] == 0


def test_someone_elses_or_unknown_quest_is_404(client, user):
    quest = week(client)["quests"][0]
    user["id"] = "someone-else"
    assert client.post(f"/api/quests/{quest['id']}/claim").status_code == 404
    assert client.post("/api/quests/00000000-0000-0000-0000-000000000000/claim").status_code == 404


def test_last_weeks_quest_cannot_be_claimed(client, fake, today):
    fake.add_decision("user-1", "skip", matched=True, cart_total="64.00")
    quest = week(client)["quests"][0]
    today["date"] += timedelta(weeks=1)
    assert client.post(f"/api/quests/{quest['id']}/claim").status_code == 409


def test_claimed_quests_level_up_the_next_time_they_appear(client, fake, today):
    fake.add_decision("user-1", "skip", matched=True, cart_total="64.00")
    for q in week(client)["quests"]:
        assert client.post(f"/api/quests/{q['id']}/claim").status_code == 200
    first_types = {q["quest_type"] for q in fake.quests}

    today["date"] += timedelta(weeks=1)
    fake.decisions.clear()
    for q in week(client)["quests"]:
        expected = 2 if q["quest_type"] in first_types else 1
        assert q["level"] == expected
        assert q["target"] == rules.target_for(q["quest_type"], expected)


# --- forest ---

def test_forest_starts_empty_and_saves_your_leaderboard_name(client, fake):
    res = client.get("/api/forest").json()
    assert (res["trees"], res["forests"], res["dollars_pledged"], res["tree_cost"]) == (0, 0, 0, 100)
    assert fake.names["user-1"] == "Deetya K."


def test_planting_spends_acorns_but_not_xp(client, fake):
    fake.profile("user-1").update(acorn_balance=250, total_xp=900)
    res = client.post("/api/forest/plant", json={"trees": 2})
    assert res.status_code == 200
    assert (res.json()["trees"], res.json()["acorn_balance"]) == (2, 50)
    assert fake.profile("user-1")["total_xp"] == 900


def test_cannot_plant_without_enough_acorns(client, fake):
    fake.profile("user-1").update(acorn_balance=99)
    assert client.post("/api/forest/plant", json={"trees": 1}).status_code == 409
    assert fake.plantings == []


def test_planting_count_is_validated(client):
    assert client.post("/api/forest/plant", json={"trees": 0}).status_code == 422
    assert client.post("/api/forest/plant", json={"trees": 31}).status_code == 422


def test_thirty_trees_complete_a_forest_and_pledge_five_dollars(client, fake):
    fake.profile("user-1").update(acorn_balance=3000)
    res = client.post("/api/forest/plant", json={"trees": 30}).json()
    assert (res["forests"], res["trees_in_current_forest"], res["dollars_pledged"]) == (1, 0, 5)


def test_leaderboard_ranks_by_trees_and_marks_you(client, fake, user):
    fake.names.update({"a": "Kevin K.", "b": "William P."})
    fake.plantings += [{"user_id": "a", "trees": 40}, {"user_id": "b", "trees": 5}]
    fake.profile("user-1").update(acorn_balance=1000)
    client.get("/api/forest")
    client.post("/api/forest/plant", json={"trees": 10})

    board = client.get("/api/forest/leaderboard").json()
    assert [(r["display_name"], r["trees"], r["forests"]) for r in board["top"]] == [
        ("Kevin K.", 40, 1), ("Deetya K.", 10, 0), ("William P.", 5, 0)]
    assert board["you"]["rank"] == 2 and board["you"]["is_you"]
    assert set(board) == {"top", "you"}  # personal forests only: no combined totals
