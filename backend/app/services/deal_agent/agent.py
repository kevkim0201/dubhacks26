"""The deal agent: a manual Gemini function-calling loop that streams playful steps.

run_deal_agent(req) is an async generator of events:
    {"event": "step",   "data": {"message": "..."}}
    {"event": "result", "data": <DealResponse dict>}
    {"event": "error",  "data": {"message": "..."}}      (only for unexpected failures)
It always ends with exactly one "result" (or "error"), so callers can stop there.
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator

from google import genai
from google.genai import errors as genai_errors
from google.genai import types

from app.core.config import get_settings

from .context import AgentContext
from .models import DealRequest, DealResponse
from .tools.coupons import check_coupons, normalize_domain
from .tools.price_history import get_price_history
from .tools.search_offers import SearchUnavailable, search_offers
from .verify import ModelJSONError, build_response, heuristic_picks, parse_model_json, unavailable_response

log = logging.getLogger("deal_agent")

MAX_TOOL_CALLS = 6
DEADLINE_S = 20.0
# Stop calling tools when this much time is left, so Gemini can still give a real answer.
ANSWER_RESERVE_S = 5.0

SYSTEM_PROMPT = """You are Nook's deal hunter. The shopper is looking at one product. Find cheaper
offers for the EXACT same item and report them.

Rules:
- Match the exact product: same model number, variant, size, color and condition. Accessories,
  bundles, cases, and used/refurbished/renewed items are NOT matches unless the source item has the
  same condition.
- Be fast. In your FIRST turn, call search_offers (brand + model number, or the identifier) AND
  check_coupons for the source store's domain together.
- Search at most twice. Only search again if the first results don't contain the item; refine the
  query (add color/size, drop marketing words) and never repeat an identical query.
- Check coupons for the domains of the 1–2 best offers in one turn (several calls at once is fine).
- get_price_history usually returns null (no data); only call it alongside other tools.
- You have at most 6 tool calls in total. Answer as soon as you are confident.

When done, reply with JSON only, no prose:
{"offers": [{"offer_id": "o3", "match_confidence": 0.93, "reason": "Same model number and color"}],
 "verdict_reason": "One short, friendly sentence about whether this is a good deal."}
Only use offer_id values that appeared in search_offers results. Include only offers you believe are
the same item; give match_confidence between 0 and 1. If nothing cheaper matches, return "offers": []."""

TOOLS = [
    types.Tool(
        function_declarations=[
            types.FunctionDeclaration(
                name="search_offers",
                description="Search Google Shopping. Returns up to 10 listings with offer_id, title, seller, price, shipping and condition.",
                parameters=types.Schema(
                    type="OBJECT",
                    properties={"query": types.Schema(type="STRING", description="Search query, ideally brand + model number")},
                    required=["query"],
                ),
            ),
            types.FunctionDeclaration(
                name="check_coupons",
                description="Known coupon codes for a store domain, e.g. bestbuy.com.",
                parameters=types.Schema(type="OBJECT", properties={"domain": types.Schema(type="STRING")}, required=["domain"]),
            ),
            types.FunctionDeclaration(
                name="get_price_history",
                description="Typical and lowest recent price for a product, or null if unknown.",
                parameters=types.Schema(type="OBJECT", properties={"product": types.Schema(type="STRING")}, required=["product"]),
            ),
        ]
    )
]


def step(message: str) -> dict:
    return {"event": "step", "data": {"message": message}}


def result(response: DealResponse) -> dict:
    return {"event": "result", "data": response.model_dump()}


def _product_brief(req: DealRequest) -> str:
    brief = {
        "title": req.title,
        "price": req.price,
        "shipping": req.shipping,
        "current_total": req.current_total,
        "currency": req.currency,
        "store_domain": normalize_domain(req.domain or req.url),
        "brand": req.brand,
        "condition": req.condition,
        "identifier": req.identifier.model_dump() if req.identifier else None,
    }
    return "Product the shopper is viewing:\n" + json.dumps(brief, indent=2)


def _short(query: str, n: int = 48) -> str:
    return query if len(query) <= n else query[: n - 1].rstrip() + "…"


async def _run_tool(ctx: AgentContext, name: str, args: dict) -> tuple[object, list[str]]:
    """Runs one tool. Returns (result for the model, step messages to show after it)."""
    if name == "search_offers":
        query = str(args.get("query", "")).strip()[:150]
        if query.lower() in (q.lower() for q in ctx.queries):
            return {"error": "You already ran this exact query. Try a different one."}, []
        found = await search_offers(ctx, query)
        used = sum(1 for o in found if o["condition"] != "new")
        notes = [f"Found {len(found)} listings to sniff through" if found else "Nothing turned up for that one, trying another angle"]
        if used:
            notes.append(f"Skipping {used} used or refurbished listing{'s' if used > 1 else ''}")
        return found, notes
    if name == "check_coupons":
        domain = normalize_domain(str(args.get("domain", "")))
        coupons = check_coupons(domain)
        ctx.coupons[domain] = coupons
        return coupons, [f"Found a coupon for {domain}!" if coupons else f"No coupons tucked away for {domain}"]
    if name == "get_price_history":
        return get_price_history(str(args.get("product", ""))), []
    return {"error": f"Unknown tool {name}"}, []


def _before_message(name: str, args: dict) -> str:
    if name == "search_offers":
        return f"Searching Google Shopping for '{_short(str(args.get('query', '')))}'..."
    if name == "check_coupons":
        return f"Checking my coupon stash for {normalize_domain(str(args.get('domain', '')))}"
    return "Checking how this price usually looks..."


async def run_deal_agent(req: DealRequest) -> AsyncIterator[dict]:
    settings = get_settings()
    ctx = AgentContext(currency=req.currency)
    started = time.monotonic()
    remaining = lambda: DEADLINE_S - (time.monotonic() - started)  # noqa: E731

    yield step(f"Ooh, {_short(req.title, 40)}! Let me check if that's a good price...")

    if not settings.gemini_api_key:
        yield step("My deal-sniffing brain isn't set up yet")
        yield result(unavailable_response(req, "the deal model isn't configured"))
        return

    client = genai.Client(api_key=settings.gemini_api_key)
    # Matching listings needs little reasoning; low thinking keeps each turn ~1-2s.
    thinking = types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
    config = types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, tools=TOOLS, temperature=0.2, thinking_config=thinking)
    contents: list[types.Content] = [types.Content(role="user", parts=[types.Part(text=_product_brief(req))])]
    final_text: str | None = None
    search_failed: str | None = None

    async def ask(cfg: types.GenerateContentConfig, msgs: list[types.Content]):
        t0 = time.monotonic()
        response = await asyncio.wait_for(
            client.aio.models.generate_content(model=settings.gemini_model, contents=msgs, config=cfg),
            timeout=max(0.5, remaining()),
        )
        log.info("gemini call %.2fs", time.monotonic() - t0)
        return response

    try:
        for _round in range(MAX_TOOL_CALLS + 2):  # rounds, not tool calls; guards against a loop
            if remaining() < ANSWER_RESERVE_S:
                break  # out of time for more tools; ask for the answer below
            response = await ask(config, contents)
            calls = response.function_calls or []
            if not calls:
                final_text = response.text
                break
            contents.append(response.candidates[0].content)

            # Announce every call, run them together, then report what each found.
            jobs = []
            for call in calls:
                args = dict(call.args or {})
                if ctx.tool_calls >= MAX_TOOL_CALLS:
                    jobs.append((call, args, None))
                    continue
                ctx.tool_calls += 1
                yield step(_before_message(call.name, args))
                jobs.append((call, args, _run_tool(ctx, call.name, args)))

            async def run_one(call, args, job):
                if job is None:
                    return {"error": "Tool limit reached. Give your final JSON answer now."}, []
                t0 = time.monotonic()
                try:
                    return await job
                except SearchUnavailable as exc:
                    nonlocal_errors.append(str(exc))
                    return {"error": "Search is unavailable right now."}, ["Hmm, my shopping search isn't answering right now"]
                finally:
                    log.info("tool %s(%s) %.2fs", call.name, args, time.monotonic() - t0)

            nonlocal_errors: list[str] = []
            outputs = await asyncio.wait_for(
                asyncio.gather(*(run_one(*job) for job in jobs)), timeout=max(0.5, remaining())
            )
            if nonlocal_errors:
                search_failed = nonlocal_errors[0]
            parts = []
            for (call, _args, _job), (output, notes) in zip(jobs, outputs):
                for note in notes:
                    yield step(note)
                parts.append(types.Part.from_function_response(name=call.name, response={"result": output}))
            contents.append(types.Content(role="user", parts=parts))

        if final_text is None:
            # Out of tool budget: ask for the answer without tools.
            closing = types.Content(role="user", parts=[types.Part(text="Give your final JSON answer now.")])
            response = await ask(types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT, response_mime_type="application/json"), [*contents, closing])
            final_text = response.text

        try:
            answer = parse_model_json(final_text)
        except ModelJSONError:
            # One formatting-only retry, no tools.
            fix = types.Content(role="user", parts=[types.Part(text=f"Reformat this as the required JSON only:\n{final_text}")])
            response = await ask(types.GenerateContentConfig(response_mime_type="application/json"), [fix])
            answer = parse_model_json(response.text)

        if search_failed and not ctx.offers:
            yield result(unavailable_response(req, "shopping search is unavailable", ctx))
            return
        yield step("Double-checking the math...")
        yield result(build_response(req, answer.get("offers") or [], ctx, answer.get("verdict_reason")))

    except (asyncio.TimeoutError, genai_errors.APIError, ModelJSONError) as exc:
        log.warning("deal agent fell back: %r", exc)
        if ctx.offers:
            yield step("Running out of time, going with what I found so far")
            yield result(build_response(req, heuristic_picks(req, ctx), ctx))
        else:
            why = "it took too long" if isinstance(exc, asyncio.TimeoutError) else "my deal model had a hiccup"
            yield result(unavailable_response(req, why, ctx))
    except Exception:  # noqa: BLE001 - always hand the extension a valid result shape
        log.exception("deal agent crashed")
        yield result(unavailable_response(req, "something went wrong on my end", ctx))
