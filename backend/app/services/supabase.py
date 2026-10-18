from datetime import datetime, timezone
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
    page_url: str | None = None,
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
            "page_url": page_url,
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


def save_conversation(
    user_id: str,
    session_id: UUID,
    *,
    assessment: str,
    suggestion: str,
    reason_summary: str | None,
    closing_line: str | None,
    transcript: list[dict[str, str]],
    duration_seconds: int | None,
    category: str | None = None,
    item_name: str | None = None,
) -> None:
    """Stores Pip's verdict and the conversation on the user's own active session."""
    rows = _request(
        "PATCH",
        "checkout_sessions",
        params={"id": f"eq.{session_id}", "user_id": f"eq.{user_id}", "status": "eq.active"},
        payload={
            "assessment": assessment,
            "suggestion": suggestion,
            "reason_summary": reason_summary,
            "closing_line": closing_line,
            "transcript": transcript,
            "duration_seconds": duration_seconds,
            "conversation_ended_at": datetime.now(timezone.utc).isoformat(),
            "category": category,
            "item_name": item_name,
        },
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "Active checkout session not found")


def fill_session_details(user_id: str, session_id: UUID, details: dict[str, Any]) -> dict[str, Any]:
    """Fills in cart fields the session started without (e.g. items the page didn't
    expose until later). Never overwrites good data. Returns the updated session."""
    rows = _request(
        "GET",
        "checkout_sessions",
        params={
            "id": f"eq.{session_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,status,store,cart_total,currency,items,page_url,category,item_name",
            "limit": "1",
        },
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "Checkout session not found")
    session = rows[0]

    patch: dict[str, Any] = {}
    items = details.get("items") or []
    if len(items) > len(session.get("items") or []):
        patch["items"] = items
    if details.get("store") and session.get("store") in (None, "", "Unknown store"):
        patch["store"] = details["store"]
    if details.get("cart_total") and float(session.get("cart_total") or 0) == 0:
        patch["cart_total"] = details["cart_total"]
    if details.get("page_url") and not session.get("page_url"):
        patch["page_url"] = details["page_url"]
    if details.get("category") and not session.get("category"):
        patch["category"] = details["category"]
    first_item = (patch.get("items") or session.get("items") or [{}])[0].get("name")
    if not session.get("item_name") and (details.get("item_name") or first_item):
        patch["item_name"] = details.get("item_name") or first_item

    if patch and session.get("status") == "active":
        _request(
            "PATCH",
            "checkout_sessions",
            params={"id": f"eq.{session_id}", "user_id": f"eq.{user_id}", "status": "eq.active"},
            payload=patch,
        )
        session.update(patch)
    return session


def tag_decision(session_id: UUID, *, category: str | None, item_name: str | None) -> None:
    """Copies category / item name onto the decision row written by record_checkout_decision."""
    if not category and not item_name:
        return
    _request(
        "PATCH",
        "decisions",
        params={"session_id": f"eq.{session_id}"},
        payload={"category": category, "item_name": item_name},
    )


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


def unequip_cosmetic(user_id: str, slot: str) -> dict[str, Any]:
    result = _request(
        "POST",
        "rpc/unequip_cosmetic",
        payload={"p_user_id": user_id, "p_slot": slot},
    )
    if not isinstance(result, dict):
        raise SupabaseUnavailable("Supabase returned an invalid cosmetic unequip result")
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


# ---------- deal checks (Pip looking for a better price after a conversation) ----------


def get_owned_session(user_id: str, session_id: UUID) -> dict[str, Any]:
    rows = _request(
        "GET",
        "checkout_sessions",
        params={
            "id": f"eq.{session_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,store,cart_total,currency,items,page_url,item_name,category,reason_summary",
            "limit": "1",
        },
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "Checkout session not found")
    return rows[0]


def insert_deal_checks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Inserts checks, skipping ones that already exist for the same session/trigger/item."""
    if not rows:
        return []
    created = _request(
        "POST",
        "deal_checks",
        params={"on_conflict": "session_id,trigger,item_name"},
        payload=rows,
        prefer="resolution=ignore-duplicates,return=representation",
    )
    return created if isinstance(created, list) else []


def list_deal_checks(user_id: str, session_id: UUID | None = None, limit: int = 50) -> list[dict[str, Any]]:
    params = {"user_id": f"eq.{user_id}", "select": "*", "order": "created_at.desc", "limit": str(limit)}
    if session_id:
        params["session_id"] = f"eq.{session_id}"
    rows = _request("GET", "deal_checks", params=params)
    return rows if isinstance(rows, list) else []


def get_deal_check(user_id: str, check_id: UUID) -> dict[str, Any]:
    rows = _request("GET", "deal_checks", params={"id": f"eq.{check_id}", "user_id": f"eq.{user_id}", "select": "*", "limit": "1"})
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "Deal check not found")
    return rows[0]


def claim_deal_check(user_id: str, check_id: UUID, now_iso: str, stale_before_iso: str) -> dict[str, Any] | None:
    """Marks a due check as running. Also reclaims checks stuck in 'running' (e.g. the popup
    closed mid-hunt). Returns the row, or None if it isn't due or someone else is running it."""
    rows = _request(
        "PATCH",
        "deal_checks",
        params={
            "id": f"eq.{check_id}",
            "user_id": f"eq.{user_id}",
            "due_at": f"lte.{now_iso}",
            "or": f"(status.in.(pending,failed),and(status.eq.running,started_at.lt.{stale_before_iso}))",
        },
        payload={"status": "running", "started_at": now_iso, "error": None},
        prefer="return=representation",
    )
    return rows[0] if isinstance(rows, list) and rows else None


def update_deal_check(user_id: str, check_id: UUID, patch: dict[str, Any]) -> None:
    _request("PATCH", "deal_checks", params={"id": f"eq.{check_id}", "user_id": f"eq.{user_id}"}, payload=patch)


# ---------- onboarding / personalization ----------


def get_onboarding(user_id: str) -> dict[str, Any]:
    """The user's onboarding state. Creates the profile row if the sign-up trigger never ran
    (accounts made before the schema existed), so new users never hit "profile not found"."""
    params = {"id": f"eq.{user_id}", "select": "id,personalization,onboarding_completed_at", "limit": "1"}
    rows = _request("GET", "profiles", params=params)
    if not isinstance(rows, list) or not rows:
        _request(
            "POST",
            "profiles",
            params={"on_conflict": "id"},
            payload={"id": user_id},
            prefer="resolution=ignore-duplicates,return=minimal",
        )
        rows = _request("GET", "profiles", params=params)
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "User profile not found")
    return rows[0]


def save_onboarding(user_id: str, personalization: dict[str, Any]) -> dict[str, Any]:
    rows = _request(
        "PATCH",
        "profiles",
        params={"id": f"eq.{user_id}", "select": "id,personalization,onboarding_completed_at"},
        payload={
            "personalization": personalization,
            "onboarding_completed_at": datetime.now(timezone.utc).isoformat(),
        },
        prefer="return=representation",
    )
    if not isinstance(rows, list) or not rows:
        raise SupabaseAPIError(404, "P0002", "User profile not found")
    return rows[0]
