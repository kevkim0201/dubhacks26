import os
from datetime import date
from uuid import uuid4

import pytest

# Settings require a Supabase URL; tests never call Supabase.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.auth import CurrentUser, get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.routers import quests as quests_router  # noqa: E402
from app.services import quests_store  # noqa: E402
from app.services.supabase import SupabaseAPIError  # noqa: E402

MONDAY = date(2026, 10, 12)


class FakeSupabase:
    """In-memory stand-in for the quests/forest tables and functions, with
    the same rules as the SQL (claim once, can't overspend acorns)."""

    def __init__(self):
        self.quests: list[dict] = []
        self.decisions: dict[str, list[dict]] = {}
        self.profiles: dict[str, dict] = {}
        self.plantings: list[dict] = []
        self.names: dict[str, str] = {}

    def profile(self, user_id):
        return self.profiles.setdefault(user_id, {"acorn_balance": 0, "total_xp": 0, "tier": "Baby"})

    def add_decision(self, user_id, decision, *, matched=False, cart_total=0):
        self.decisions.setdefault(user_id, []).append(
            {"decision": decision, "recommendation_matched": matched, "cart_total": cart_total}
        )

    # --- quests_store API ---
    def list_week_quests(self, user_id, week_start):
        return sorted(
            (dict(q) for q in self.quests if q["user_id"] == user_id and q["week_start"] == week_start.isoformat()),
            key=lambda q: q["slot"],
        )

    def claimed_counts(self, user_id):
        counts = {}
        for q in self.quests:
            if q["user_id"] == user_id and q["status"] == "claimed":
                counts[q["quest_type"]] = counts.get(q["quest_type"], 0) + 1
        return counts

    def create_week_quests(self, user_id, week_start, plans):
        for p in plans:
            if any(q["user_id"] == user_id and q["week_start"] == week_start.isoformat() and q["slot"] == p.slot
                   for q in self.quests):
                continue  # on conflict do nothing
            self.quests.append({
                "id": str(uuid4()), "user_id": user_id, "week_start": week_start.isoformat(),
                "slot": p.slot, "quest_type": p.quest_type, "level": p.level, "target": str(p.target),
                "reward_acorns": p.reward_acorns, "status": "active", "claimed_at": None,
            })

    def get_quest(self, user_id, quest_id):
        return next((dict(q) for q in self.quests if q["id"] == str(quest_id) and q["user_id"] == user_id), None)

    def list_week_decisions(self, user_id, week_start):
        return list(self.decisions.get(user_id, []))

    def claim_quest_reward(self, user_id, quest_id):
        quest = next((q for q in self.quests if q["id"] == str(quest_id) and q["user_id"] == user_id), None)
        if quest is None:
            raise SupabaseAPIError(400, "P0002", "Quest not found")
        if quest["status"] == "claimed":
            raise SupabaseAPIError(400, "55000", "Quest reward already claimed")
        quest["status"], quest["claimed_at"] = "claimed", "now"
        p = self.profile(user_id)
        p["acorn_balance"] += quest["reward_acorns"]
        p["total_xp"] += quest["reward_acorns"]
        return {"reward_acorns": quest["reward_acorns"], **p}

    def get_balance(self, user_id):
        return dict(self.profile(user_id))

    def total_trees(self, user_id):
        return sum(p["trees"] for p in self.plantings if p["user_id"] == user_id)

    def save_display_name(self, user_id, display_name):
        self.names[user_id] = display_name

    def plant_trees(self, user_id, trees):
        p = self.profile(user_id)
        cost = trees * 100
        if p["acorn_balance"] < cost:
            raise SupabaseAPIError(400, "22023", "Not enough acorns")
        p["acorn_balance"] -= cost
        self.plantings.append({"user_id": user_id, "trees": trees})
        return {"trees_planted": trees, "acorns_spent": cost, "acorn_balance": p["acorn_balance"],
                "total_trees": self.total_trees(user_id)}

    def forest_leaderboard(self, user_id, limit):
        totals = {}
        for p in self.plantings:
            totals[p["user_id"]] = totals.get(p["user_id"], 0) + p["trees"]
        ordered = sorted(totals.items(), key=lambda kv: -kv[1])
        rows = [
            {"rank": i + 1, "display_name": self.names.get(uid, "Forager"), "trees": t,
             "forests": t // 30, "is_you": uid == user_id}
            for i, (uid, t) in enumerate(ordered)
        ]
        you = next((r for r in rows if r["is_you"]), None)
        return {"top": rows[:limit], "you": you}


@pytest.fixture
def fake(monkeypatch):
    db = FakeSupabase()
    for name in ("list_week_quests", "claimed_counts", "create_week_quests", "get_quest",
                 "list_week_decisions", "claim_quest_reward", "get_balance", "total_trees",
                 "save_display_name", "plant_trees", "forest_leaderboard"):
        monkeypatch.setattr(quests_store, name, getattr(db, name))
    return db


@pytest.fixture
def user():
    """Mutable so a test can switch who's signed in."""
    return {"id": "user-1", "name": "Deetya Kamat"}


@pytest.fixture
def today():
    return {"date": MONDAY}


@pytest.fixture
def client(fake, user, today):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id=user["id"], claims={"user_metadata": {"full_name": user["name"]}}
    )
    app.dependency_overrides[quests_router.get_today] = lambda: today["date"]
    yield TestClient(app)
    app.dependency_overrides.clear()
