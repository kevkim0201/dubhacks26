"""Deal checks: run the deal agent on items from a checkout conversation.

- After "buy", the popup asks Pip to look for a better deal right away (trigger "buy").
- After "wait", a check is scheduled for 24 hours later (trigger "wait") and runs the first time
  the dashboard is opened after that, so the prices are fresh when the user decides.
"""

import logging
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Literal
from urllib.parse import urlsplit
from uuid import UUID

from app.services.deal_agent.models import DealRequest, DealResponse
from app.services.deal_agent.service import hunt
from app.services.supabase import (
    claim_deal_check,
    get_deal_check,
    get_owned_session,
    insert_deal_checks,
    list_deal_checks,
    update_deal_check,
)

log = logging.getLogger("deal_checks")

Trigger = Literal["buy", "wait"]
WAIT_HOURS = 24
MAX_ITEMS = 3
STALE_RUN = timedelta(minutes=2)


def _price(value: Any) -> float | None:
    try:
        amount = float(Decimal(str(value)))
    except (InvalidOperation, ValueError, TypeError):
        return None
    return amount if amount > 0 else None


def select_items(session: dict[str, Any]) -> list[dict[str, Any]]:
    """The most expensive priced items (up to 3). A one-item cart with no item price uses the
    cart total; an empty item list falls back to the item Pip identified in the conversation."""
    items = [i for i in (session.get("items") or []) if (i.get("name") or "").strip()]
    priced = [{"name": i["name"].strip(), "price": p} for i in items if (p := _price(i.get("price")))]
    if not priced:
        total = _price(session.get("cart_total"))
        name = items[0]["name"].strip() if len(items) == 1 else session.get("item_name")
        priced = [{"name": name, "price": total}] if name and total else []
    seen, unique = set(), []
    for item in sorted(priced, key=lambda i: i["price"], reverse=True):
        if item["name"].lower() not in seen:
            seen.add(item["name"].lower())
            unique.append(item)
    return unique[:MAX_ITEMS]


def schedule(user_id: str, session_id: UUID, trigger: Trigger) -> list[dict[str, Any]]:
    """Creates checks for a session's items. Re-running is safe (duplicates are skipped)."""
    session = get_owned_session(user_id, session_id)
    now = datetime.now(timezone.utc)
    due = now + timedelta(hours=WAIT_HOURS) if trigger == "wait" else now
    rows = [
        {
            "user_id": user_id,
            "session_id": str(session_id),
            "trigger": trigger,
            "item_name": item["name"][:200],
            "item_price": round(item["price"], 2),
            "currency": session.get("currency") or "USD",
            "store": session.get("store"),
            "page_url": session.get("page_url"),
            "due_at": due.isoformat(),
        }
        for item in select_items(session)
    ]
    insert_deal_checks(rows)
    return [c for c in list_deal_checks(user_id, session_id) if c["trigger"] == trigger]


def deal_request(check: dict[str, Any], session: dict[str, Any] | None = None) -> DealRequest:
    """The deal agent's input. The conversation's reason (what the shopper needs it for) steers
    the similar picks; the category helps it search for the right kind of product."""
    url = check.get("page_url") or ""
    host = urlsplit(url).hostname if url else None
    session = session or {}
    return DealRequest(
        title=check["item_name"],
        price=float(check["item_price"]),
        currency=check.get("currency") or "USD",
        url=url or "https://unknown.invalid/",
        domain=host,
        need=(session.get("reason_summary") or "")[:500] or None,
        category=session.get("category"),
    )


async def run(user_id: str, check_id: UUID) -> AsyncIterator[dict]:
    """Streams the hunt for one check and stores the result. Finished checks replay their result."""
    check = get_deal_check(user_id, check_id)
    if check["status"] == "done" and check.get("result"):
        yield {"event": "result", "data": check["result"]}
        return

    now = datetime.now(timezone.utc)
    if datetime.fromisoformat(check["due_at"].replace("Z", "+00:00")) > now:
        yield {"event": "error", "data": {"message": "Pip will check this one when your wait is over."}}
        return
    claimed = claim_deal_check(user_id, check_id, now.isoformat(), (now - STALE_RUN).isoformat())
    if claimed is None:
        yield {"event": "error", "data": {"message": "Pip is already checking this one."}}
        return

    session = None
    if claimed.get("session_id"):
        try:
            session = get_owned_session(user_id, claimed["session_id"])
        except Exception:  # noqa: BLE001 - the hunt still works without the reason
            log.warning("no session context for deal check %s", check_id)

    try:
        async for event in hunt(deal_request(claimed, session)):
            if event["event"] == "result":
                DealResponse(**event["data"])  # validate before storing
                update_deal_check(user_id, check_id, {
                    "status": "done",
                    "result": event["data"],
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                })
            yield event
    except Exception as exc:  # noqa: BLE001 - leave the check retryable
        log.exception("deal check %s failed", check_id)
        update_deal_check(user_id, check_id, {"status": "failed", "error": str(exc)[:500]})
        yield {"event": "error", "data": {"message": "Pip couldn't finish this check. Try again in a bit."}}
