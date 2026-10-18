"""Dashboard numbers: what the user's pauses with Pip added up to."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from app.core.auth import AuthUser
from app.services.supabase import (
    SupabaseAPIError,
    SupabaseConfigurationError,
    SupabaseUnavailable,
    count_conversations_since,
    list_decisions_since,
)

router = APIRouter(prefix="/api", tags=["impact"])

# Stored decision -> what the dashboard calls it.
OUTCOMES = {"skip": "avoided", "save": "postponed", "buy": "proceeded"}
Outcome = Literal["all", "avoided", "postponed", "proceeded"]


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01")))


def _week_starts(today: date, weeks: int) -> list[date]:
    # Weeks run Monday–Sunday; the last bucket is the current week.
    this_monday = today - timedelta(days=today.weekday())
    return [this_monday - timedelta(weeks=weeks - 1 - i) for i in range(weeks)]


def _summarize(rows: list[dict], week_starts: list[date]) -> dict:
    totals = {o: {"count": 0, "amount": Decimal(0)} for o in OUTCOMES.values()}
    weekly = [
        {"week_start": ws.isoformat(), "saved": Decimal(0), "avoided": 0, "postponed": 0, "proceeded": 0}
        for ws in week_starts
    ]
    for row in rows:
        outcome = OUTCOMES[row["decision"]]
        amount = Decimal(str(row["cart_total"]))
        totals[outcome]["count"] += 1
        totals[outcome]["amount"] += amount

        day = datetime.fromisoformat(row["created_at"].replace("Z", "+00:00")).date()
        idx = max(i for i, ws in enumerate(week_starts) if ws <= day) if day >= week_starts[0] else None
        if idx is not None:
            weekly[idx][outcome] += 1
            if outcome == "avoided":
                weekly[idx]["saved"] += amount

    cumulative = Decimal(0)
    for week in weekly:
        cumulative += week["saved"]
        week["cumulative_saved"] = _money(cumulative)
        week["saved"] = _money(week["saved"])

    decisions = sum(t["count"] for t in totals.values())
    return {
        "decisions": decisions,
        "money_saved": _money(totals["avoided"]["amount"]),
        "outcomes": {
            name: {
                "count": t["count"],
                "amount": _money(t["amount"]),
                "share": round(t["count"] / decisions, 4) if decisions else 0,
            }
            for name, t in totals.items()
        },
        "weekly": weekly,
    }


def _decision_row(row: dict) -> dict:
    items = row.get("items") or []
    first = items[0] if items else {}
    outcome = OUTCOMES[row["decision"]]
    total = Decimal(str(row["cart_total"]))
    name = first.get("name") or "Cart"
    if len(items) > 1:
        name = f"{name} + {len(items) - 1} more"
    return {
        "id": row["id"],
        "name": name,
        "store": row["store"],
        "image": first.get("image"),
        "date": row["created_at"],
        "cart_total": _money(total),
        "currency": row["currency"],
        "outcome": outcome,
        "saved": _money(total) if outcome == "avoided" else None,
    }


@router.get("/impact")
def impact(
    user: AuthUser,
    weeks: int = Query(default=4, ge=1, le=52),
    outcome: Outcome = "all",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=6, ge=1, le=50),
) -> dict:
    today = datetime.now(timezone.utc).date()
    week_starts = _week_starts(today, weeks)
    since = datetime.combine(week_starts[0], time.min, tzinfo=timezone.utc)

    try:
        rows = list_decisions_since(user.id, since.isoformat())
        conversations = count_conversations_since(user.id, since.isoformat())
    except SupabaseConfigurationError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    except SupabaseUnavailable as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    except SupabaseAPIError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    filtered = [r for r in rows if outcome == "all" or OUTCOMES[r["decision"]] == outcome]
    start = (page - 1) * page_size

    return {
        "range": {"start": week_starts[0].isoformat(), "end": today.isoformat(), "weeks": weeks},
        "currency": rows[0]["currency"] if rows else "USD",
        "conversations": max(conversations, len(rows)),
        **_summarize(rows, week_starts),
        "recent": {
            "items": [_decision_row(r) for r in filtered[start : start + page_size]],
            "total": len(filtered),
            "page": page,
            "page_size": page_size,
        },
    }
