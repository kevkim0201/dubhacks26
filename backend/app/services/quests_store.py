"""Supabase reads and writes for quests and the forest.

Uses the same service-role client as app/services/supabase.py; the tables
and functions come from supabase/migrations/20261018_quests_forest.sql.
"""

from datetime import date
from typing import Any
from uuid import UUID

from app.services.quests import QuestPlan
from app.services.supabase import SupabaseUnavailable, _request


def _rows(result: Any, what: str) -> list[dict[str, Any]]:
    if not isinstance(result, list):
        raise SupabaseUnavailable(f"Supabase returned an invalid {what}")
    return result


def _object(result: Any, what: str) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise SupabaseUnavailable(f"Supabase returned an invalid {what}")
    return result


QUEST_COLUMNS = "id,week_start,slot,quest_type,level,target,reward_acorns,status,claimed_at"


def list_week_quests(user_id: str, week_start: date) -> list[dict[str, Any]]:
    return _rows(_request("GET", "user_quests", params={
        "user_id": f"eq.{user_id}",
        "week_start": f"eq.{week_start.isoformat()}",
        "select": QUEST_COLUMNS,
        "order": "slot.asc",
    }), "quest list")


def claimed_counts(user_id: str) -> dict[str, int]:
    """How many quests of each type the user has claimed, ever (sets the level)."""
    rows = _rows(_request("GET", "user_quests", params={
        "user_id": f"eq.{user_id}",
        "status": "eq.claimed",
        "select": "quest_type",
        "limit": "1000",
    }), "quest history")
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["quest_type"]] = counts.get(row["quest_type"], 0) + 1
    return counts


def create_week_quests(user_id: str, week_start: date, plans: list[QuestPlan]) -> None:
    """Insert this week's quests. If two requests race, the unique
    (user, week, slot) key keeps the first set and ignores the rest."""
    _request(
        "POST",
        "user_quests",
        params={"on_conflict": "user_id,week_start,slot"},
        payload=[  # type: ignore[arg-type]  # PostgREST accepts a list of rows
            {
                "user_id": user_id,
                "week_start": week_start.isoformat(),
                "slot": p.slot,
                "quest_type": p.quest_type,
                "level": p.level,
                "target": p.target,
                "reward_acorns": p.reward_acorns,
            }
            for p in plans
        ],
        prefer="resolution=ignore-duplicates,return=minimal",
    )


def get_quest(user_id: str, quest_id: UUID) -> dict[str, Any] | None:
    rows = _rows(_request("GET", "user_quests", params={
        "id": f"eq.{quest_id}",
        "user_id": f"eq.{user_id}",
        "select": QUEST_COLUMNS,
        "limit": "1",
    }), "quest")
    return rows[0] if rows else None


def list_week_decisions(user_id: str, week_start: date) -> list[dict[str, Any]]:
    return _rows(_request("GET", "decisions", params={
        "user_id": f"eq.{user_id}",
        "created_at": f"gte.{week_start.isoformat()}T00:00:00Z",
        "select": "decision,recommendation_matched,cart_total,created_at",
        "limit": "1000",
    }), "decision history")


def claim_quest_reward(user_id: str, quest_id: UUID) -> dict[str, Any]:
    return _object(_request("POST", "rpc/claim_quest_reward", payload={
        "p_user_id": user_id, "p_quest_id": str(quest_id),
    }), "quest claim result")


def get_balance(user_id: str) -> dict[str, Any]:
    rows = _rows(_request("GET", "profiles", params={
        "id": f"eq.{user_id}",
        "select": "acorn_balance,total_xp,tier",
        "limit": "1",
    }), "profile")
    return rows[0] if rows else {"acorn_balance": 0, "total_xp": 0, "tier": "Baby"}


def total_trees(user_id: str) -> int:
    rows = _rows(_request("GET", "forest_plantings", params={
        "user_id": f"eq.{user_id}",
        "select": "trees",
        "limit": "10000",
    }), "planting history")
    return sum(int(row["trees"]) for row in rows)


def save_display_name(user_id: str, display_name: str) -> None:
    _request(
        "POST",
        "forest_members",
        params={"on_conflict": "user_id"},
        payload={"user_id": user_id, "display_name": display_name},
        prefer="resolution=merge-duplicates,return=minimal",
    )


def plant_trees(user_id: str, trees: int) -> dict[str, Any]:
    return _object(_request("POST", "rpc/plant_trees", payload={
        "p_user_id": user_id, "p_trees": trees,
    }), "planting result")


def forest_leaderboard(user_id: str, limit: int) -> dict[str, Any]:
    return _object(_request("POST", "rpc/forest_leaderboard", payload={
        "p_user_id": user_id, "p_limit": limit,
    }), "leaderboard")
