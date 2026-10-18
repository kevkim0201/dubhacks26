"""Deal agent API: "is this a good deal?" for the product the shopper is viewing.
Contract: DEAL_AGENT_PLAN.md. No auth by design (hackathon); results are cached per product."""

import json

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.services.deal_agent.models import DealRequest, DealResponse
from app.services.deal_agent.service import hunt

router = APIRouter(prefix="/api/deals", tags=["deals"])


def _require_price(req: DealRequest) -> DealRequest:
    if req.price is None:
        raise HTTPException(
            422,
            "price is required: send the price shown on the product page",
        )
    return req


def _sse(event: dict) -> str:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"


def _stream(req: DealRequest) -> StreamingResponse:
    async def events():
        async for event in hunt(req):
            yield _sse(event)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("", response_model=DealResponse)
async def find_deals(payload: DealRequest) -> dict:
    req = _require_price(payload)
    async for event in hunt(req):
        if event["event"] == "result":
            return event["data"]
        if event["event"] == "error":
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, event["data"]["message"])
    raise HTTPException(status.HTTP_502_BAD_GATEWAY, "The deal agent ended without a result")


@router.get("/stream")
async def stream_deals_get(payload: str = Query(..., description="URL-encoded DealRequest JSON")) -> StreamingResponse:
    try:
        req = DealRequest.model_validate_json(payload)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json())) from exc
    return _stream(_require_price(req))


@router.post("/stream")
async def stream_deals_post(payload: DealRequest) -> StreamingResponse:
    """Same events as GET, for fetch()-based SSE readers in the extension's service worker."""
    return _stream(_require_price(payload))
