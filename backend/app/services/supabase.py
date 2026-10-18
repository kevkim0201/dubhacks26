from typing import Any
from uuid import UUID

import httpx

from app.core.config import get_settings


class SupabaseConfigurationError(RuntimeError):
    pass


class SupabaseUnavailable(RuntimeError):
    pass


class SupabaseAPIError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


def _request(
    method: str,
    path: str,
    *,
    params: dict[str, str] | None = None,
    payload: dict[str, Any] | None = None,
    prefer: str | None = None,
) -> Any:
    settings = get_settings()
    if not settings.supabase_service_role_key:
        raise SupabaseConfigurationError("SUPABASE_SERVICE_ROLE_KEY is not configured")

    key = settings.supabase_service_role_key
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    try:
        response = httpx.request(
            method,
            f"{settings.supabase_url.rstrip('/')}/rest/v1/{path}",
            headers=headers,
            params=params,
            json=payload,
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise SupabaseUnavailable("Could not reach Supabase") from exc

    if not response.is_success:
        try:
            error = response.json()
        except ValueError:
            error = {}
        if not isinstance(error, dict):
            error = {}
        raise SupabaseAPIError(
            status_code=response.status_code,
            code=str(error.get("code", "")),
            message=str(error.get("message", "Supabase request failed")),
        )

    if response.status_code == 204 or not response.content:
        return None
    try:
        return response.json()
    except ValueError as exc:
        raise SupabaseUnavailable("Supabase returned an invalid response") from exc


def create_checkout_session(
    user_id: str,
    *,
    store: str,
    cart_total: str,
    currency: str,
    items: list[dict[str, Any]],
) -> dict[str, Any]:
    rows = _request(
        "POST",
        "checkout_sessions",
        payload={
            "user_id": user_id,
            "store": store,
            "cart_total": cart_total,
            "currency": currency,
            "items": items,
        },
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseUnavailable("Supabase did not return the created checkout session")
    return rows[0]


def save_assessment(
    session_id: UUID,
    *,
    assessment: str,
    suggestion: str,
    reason_summary: str | None,
    closing_line: str | None,
) -> None:
    rows = _request(
        "PATCH",
        "checkout_sessions",
        params={"id": f"eq.{session_id}", "status": "eq.active"},
        payload={
            "assessment": assessment,
            "suggestion": suggestion,
            "reason_summary": reason_summary,
            "closing_line": closing_line,
        },
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "Active checkout session not found")


def record_checkout_decision(
    user_id: str,
    session_id: UUID,
    decision: str,
) -> dict[str, Any]:
    result = _request(
        "POST",
        "rpc/record_checkout_decision",
        payload={
            "p_user_id": user_id,
            "p_session_id": str(session_id),
            "p_decision": decision,
        },
    )
    if not isinstance(result, dict):
        raise SupabaseUnavailable("Supabase returned an invalid decision result")
    return result


def get_user_state(user_id: str) -> dict[str, Any]:
    profiles = _request(
        "GET",
        "profiles",
        params={
            "id": f"eq.{user_id}",
            "select": "id,username,total_xp,acorn_balance,tier",
            "limit": "1",
        },
    )
    if not isinstance(profiles, list) or not profiles:
        raise SupabaseAPIError(404, "P0002", "User profile not found")

    decisions = _request(
        "GET",
        "decisions",
        params={
            "user_id": f"eq.{user_id}",
            "select": (
                "id,session_id,decision,recommended_decision,"
                "recommendation_matched,total_acorns,xp_awarded,created_at"
            ),
            "order": "created_at.desc",
            "limit": "20",
        },
    )
    if not isinstance(decisions, list):
        raise SupabaseUnavailable("Supabase returned an invalid decision history")

    return {"profile": profiles[0], "recent_decisions": decisions}


def get_avatar_state(user_id: str) -> dict[str, Any]:
    profiles = _request(
        "GET",
        "profiles",
        params={
            "id": f"eq.{user_id}",
            "select": "id,total_xp,acorn_balance,tier",
            "limit": "1",
        },
    )
    if not isinstance(profiles, list) or not profiles:
        raise SupabaseAPIError(404, "P0002", "User profile not found")

    cosmetics = _request(
        "GET",
        "cosmetics",
        params={
            "is_active": "eq.true",
            "select": "id,name,description,category,cost_acorns,minimum_tier,asset_key,is_tier_gift",
            "order": "category.asc,cost_acorns.asc,name.asc",
        },
    )
    if not isinstance(cosmetics, list):
        raise SupabaseUnavailable("Supabase returned an invalid cosmetics catalog")
    if not cosmetics:
        raise SupabaseUnavailable(
            "The cosmetics catalog is empty; apply the avatar cosmetics Supabase migration"
        )

    owned_rows = _request(
        "GET",
        "user_cosmetics",
        params={
            "user_id": f"eq.{user_id}",
            "select": "cosmetic_id,is_equipped,slot",
        },
    )
    if not isinstance(owned_rows, list):
        raise SupabaseUnavailable("Supabase returned invalid owned cosmetics")

    owned = {row["cosmetic_id"]: row for row in owned_rows}
    equipped = {
        row["slot"]: row["cosmetic_id"]
        for row in owned_rows
        if row.get("is_equipped") and row.get("slot")
    }
    catalog = [
        {
            **cosmetic,
            "owned": cosmetic["id"] in owned,
            "equipped": bool(owned.get(cosmetic["id"], {}).get("is_equipped")),
        }
        for cosmetic in cosmetics
    ]
    return {"profile": profiles[0], "cosmetics": catalog, "equipped": equipped}


def purchase_cosmetic(user_id: str, cosmetic_id: str) -> dict[str, Any]:
    result = _request(
        "POST",
        "rpc/purchase_cosmetic",
        payload={"p_user_id": user_id, "p_cosmetic_id": cosmetic_id},
    )
    if not isinstance(result, dict):
        raise SupabaseUnavailable("Supabase returned an invalid cosmetic purchase result")
    return result


def equip_cosmetic(user_id: str, cosmetic_id: str) -> dict[str, Any]:
    result = _request(
        "POST",
        "rpc/equip_cosmetic",
        payload={"p_user_id": user_id, "p_cosmetic_id": cosmetic_id},
    )
    if not isinstance(result, dict):
        raise SupabaseUnavailable("Supabase returned an invalid cosmetic equip result")
    return result


def list_decisions_since(user_id: str, since_iso: str) -> list[dict[str, Any]]:
    rows = _request(
        "GET",
        "decisions",
        params={
            "user_id": f"eq.{user_id}",
            "created_at": f"gte.{since_iso}",
            "select": "id,session_id,store,cart_total,currency,items,decision,created_at",
            "order": "created_at.desc",
            "limit": "1000",
        },
    )
    if not isinstance(rows, list):
        raise SupabaseUnavailable("Supabase returned an invalid decision history")
    return rows


def count_conversations_since(user_id: str, since_iso: str) -> int:
    rows = _request(
        "GET",
        "checkout_sessions",
        params={
            "user_id": f"eq.{user_id}",
            "created_at": f"gte.{since_iso}",
            "assessment": "not.is.null",
            "select": "id",
            "limit": "1000",
        },
    )
    if not isinstance(rows, list):
        raise SupabaseUnavailable("Supabase returned an invalid session list")
    return len(rows)
