"""Your personal forest: your trees, planting with acorns, and the leaderboard."""

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.auth import AuthUser
from app.services import quests as rules
from app.services import quests_store as store
from app.services.supabase import SupabaseAPIError, SupabaseConfigurationError, SupabaseUnavailable

router = APIRouter(prefix="/api/forest", tags=["forest"])


class PlantRequest(BaseModel):
    trees: int = Field(default=1, ge=1, le=30)


def _raise(exc: Exception) -> None:
    if isinstance(exc, SupabaseConfigurationError):
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    if isinstance(exc, SupabaseUnavailable):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if isinstance(exc, SupabaseAPIError):
        code = {
            "22023": status.HTTP_409_CONFLICT,   # not enough acorns / bad count
            "P0002": status.HTTP_404_NOT_FOUND,
        }.get(exc.code, status.HTTP_502_BAD_GATEWAY)
        raise HTTPException(code, str(exc)) from exc
    raise exc


def _forest(user_id: str) -> dict:
    balance = store.get_balance(user_id)
    return {
        **rules.forest_summary(store.total_trees(user_id)),
        "acorn_balance": balance["acorn_balance"],
        "dollars_per_forest": rules.DOLLARS_PER_FOREST,
    }


@router.get("")
def my_forest(user: AuthUser) -> dict:
    """Your trees, completed forests and pledge. Also saves the name shown on the leaderboard."""
    try:
        store.save_display_name(user.id, rules.display_name(user.claims))
        return _forest(user.id)
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        _raise(exc)


@router.post("/plant")
def plant(payload: PlantRequest, user: AuthUser) -> dict:
    """Spend 100 acorns per tree. XP is not affected."""
    try:
        result = store.plant_trees(user.id, payload.trees)
        return {"result": result, **_forest(user.id)}
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        _raise(exc)


@router.get("/leaderboard")
def leaderboard(user: AuthUser, limit: int = Query(default=10, ge=1, le=50)) -> dict:
    """Top planters by trees, with forests completed, plus your own rank."""
    try:
        return store.forest_leaderboard(user.id, limit)
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        _raise(exc)
