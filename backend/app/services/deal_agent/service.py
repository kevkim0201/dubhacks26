"""Entry point: picks cache, demo fixtures or the live agent, and caches final results."""

from collections.abc import AsyncIterator

from app.core.config import get_settings

from . import cache
from .agent import run_deal_agent
from .demo import run_demo
from .models import DealRequest, DealResponse


async def hunt(req: DealRequest) -> AsyncIterator[dict]:
    cached = cache.get(req)
    if cached:
        yield {"event": "step", "data": {"message": "I've sniffed this one out before!"}}
        yield {"event": "result", "data": cached.model_dump()}
        return
    source = run_demo(req) if get_settings().demo_mode else run_deal_agent(req)
    async for event in source:
        if event["event"] == "result":
            cache.put(req, DealResponse(**event["data"]))
        yield event
