"""Deal checks for the signed-in user: Pip looking for a better price after a conversation.

POST /api/deal-checks             {session_id, trigger: "buy"|"wait"} -> the session's checks
POST /api/deal-checks/{id}/run    -> SSE (step / result / error) while Pip hunts; stores the result
GET  /api/deal-checks             -> the user's checks (dashboard)
POST /api/deal-checks/{id}/seen   -> hides a finished check from "Your wait is over"
"""

import json
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.auth import AuthUser
from app.services import deal_checks
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    get_deal_check,
    list_deal_checks,
    update_deal_check,
)

router = APIRouter(prefix="/api/deal-checks", tags=["deal checks"])


class ScheduleRequest(BaseModel):
    session_id: UUID
    trigger: Literal["buy", "wait"]


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, SupabaseConfigurationError):
        return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
    if isinstance(exc, SupabaseAPIError) and exc.code == "P0002":
        return HTTPException(status.HTTP_404_NOT_FOUND, str(exc))
    return HTTPException(status.HTTP_502_BAD_GATEWAY, f"Deal checks unavailable: {exc}")


def _view(check: dict) -> dict:
    """Adds `due` so the dashboard knows which pending checks to run now."""
    due_at = datetime.fromisoformat(check["due_at"].replace("Z", "+00:00"))
    return {**check, "due": due_at <= datetime.now(timezone.utc)}


@router.post("", status_code=status.HTTP_201_CREATED)
def schedule_checks(payload: ScheduleRequest, user: AuthUser) -> dict:
    try:
        checks = deal_checks.schedule(user.id, payload.session_id, payload.trigger)
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc
    if not checks:
        raise HTTPException(422,
                            "No priced items in this cart for Pip to check")
    return {"checks": [_view(c) for c in checks]}


@router.get("")
def my_checks(user: AuthUser) -> dict:
    try:
        return {"checks": [_view(c) for c in list_deal_checks(user.id)]}
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc


@router.post("/{check_id}/run")
async def run_check(check_id: UUID, user: AuthUser) -> StreamingResponse:
    try:
        get_deal_check(user.id, check_id)  # 404 before opening the stream
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc

    async def events():
        async for event in deal_checks.run(user.id, check_id):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/{check_id}/seen")
def mark_seen(check_id: UUID, user: AuthUser) -> dict:
    try:
        get_deal_check(user.id, check_id)
        update_deal_check(user.id, check_id, {"seen_at": datetime.now(timezone.utc).isoformat()})
    except (SupabaseConfigurationError, SupabaseUnavailable, SupabaseAPIError) as exc:
        raise _http_error(exc) from exc
    return {"id": str(check_id), "seen": True}
