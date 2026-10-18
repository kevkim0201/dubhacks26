"""In-memory TTL cache for deal results, keyed by product identifier or normalized URL."""

import time
from urllib.parse import urlsplit, urlunsplit

from .models import DealRequest, DealResponse

TTL_S = 30 * 60
_store: dict[str, tuple[float, DealResponse]] = {}


def normalize_url(url: str) -> str:
    """Drops the query string (where tracking tags live), 'www.' and trailing slashes.
    Keeps the #fragment: single-page stores (like the demo store) put the product there."""
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    host = host[4:] if host.startswith("www.") else host
    if parts.port:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme.lower() or "https", host, parts.path.rstrip("/"), "", parts.fragment))


def cache_key(req: DealRequest) -> str:
    if req.identifier:
        return f"{req.identifier.type}:{req.identifier.value.strip().lower()}|{req.currency}|{req.current_total:.2f}"
    return f"url:{normalize_url(req.url)}|{req.currency}|{req.current_total:.2f}"


def get(req: DealRequest) -> DealResponse | None:
    entry = _store.get(cache_key(req))
    if not entry:
        return None
    expires, response = entry
    if time.monotonic() > expires:
        _store.pop(cache_key(req), None)
        return None
    return response.model_copy(update={"cached": True})


def put(req: DealRequest, response: DealResponse) -> None:
    # Don't cache "couldn't check" answers; the next try might work.
    if response.verdict == "fair" and not response.offers and "couldn't compare" in response.verdict_reason:
        return
    _store[cache_key(req)] = (time.monotonic() + TTL_S, response.model_copy(update={"cached": False}))


def clear() -> None:
    _store.clear()
