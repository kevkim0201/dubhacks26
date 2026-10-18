"""Personal weekly quests: GET this week's 3 quests, POST to claim one."""

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import AuthUser
from app.services import quests as rules
from app.services import quests_store as store
from app.services.supabase import SupabaseAPIError, SupabaseConfigurationError, SupabaseUnavailable

router = APIRouter(prefix="/api/quests", tags=["quests"])


def get_today():
    return datetime.now(timezone.utc).date()


Today = Annotated[object, Depends(get_today)]


def _raise(exc: Exception) -> None:
    if isinstance(exc, SupabaseConfigurationError):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if isinstance(exc, SupabaseUnavailable):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if isinstance(exc, SupabaseAPIError):
        code = {
            "P0002": status.HTTP_404_NOT_FOUND,
            "55000": status.HTTP_409_CONFLICT,
            "23505": status.HTTP_409_CONFLICT,
        }.get(exc.code, status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(code, str(exc)) from exc
    raise exc


def _with_progress(quest: dict, decisions: list[dict]) -> dict:
    done = rules.progress(quest["quest_type"], decisions)
    target = float(quest["target"])
    current = min(float(done), target)
    return {
        **quest,
        **rules.describe(quest["quest_type"], int(target)),
        "target": target,
        "progress": current,
        "complete": float(done) >= target,
        "claimable": quest["status"] == "active" and float(done) >= target,
    }


def _week(user_id: str, today) -> dict:
    monday = rules.week_start(today)
    quests = store.list_week_quests(user_id, monday)
    if len(quests) < rules.QUESTS_PER_WEEK:
        store.create_week_quests(user_id, monday, rules.plan_week(monday, store.claimed_counts(user_id)))
        quests = store.list_week_quests(user_id, monday)
    decisions = store.list_week_decisions(user_id, monday)
    return {
        "week_start": monday.isoformat(),
        "quests": [_with_progress(q, decisions) for q in quests],
    }


@router.get("")
def this_week(user: AuthUser, today: Today) -> dict:
    """This week's 3 quests with progress. Created on the first visit each week."""
    try:
        return _week(user.id, today)
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        _raise(exc)


@router.post("/{quest_id}/claim")
def claim(quest_id: UUID, user: AuthUser, today: Today) -> dict:
    """Pay a completed quest's reward (acorns and XP) once."""
    try:
        quest = store.get_quest(user.id, quest_id)
        if quest is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Quest not found")
        if quest["week_start"] != rules.week_start(today).isoformat():
            raise HTTPException(status.HTTP_409_CONFLICT, "That quest is from a past week")
        if quest["status"] == "claimed":
            raise HTTPException(status.HTTP_409_CONFLICT, "Quest reward already claimed")
        decisions = store.list_week_decisions(user.id, rules.week_start(today))
        if not _with_progress(quest, decisions)["complete"]:
            raise HTTPException(status.HTTP_409_CONFLICT, "Quest isn't complete yet")
        result = store.claim_quest_reward(user.id, quest_id)
        return {"result": result, **_week(user.id, today)}
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        _raise(exc)
