"""Coupon lookup. Starts from a static JSON file keyed by domain (fixtures/coupons.json)."""

import json
from functools import lru_cache
from pathlib import Path

COUPONS_FILE = Path(__file__).resolve().parents[1] / "fixtures" / "coupons.json"


@lru_cache
def _coupons() -> dict[str, list[dict]]:
    return json.loads(COUPONS_FILE.read_text())


def normalize_domain(domain: str) -> str:
    domain = (domain or "").lower().strip()
    domain = domain.split("//")[-1].split("/")[0].split(":")[0]
    return domain[4:] if domain.startswith("www.") else domain


def check_coupons(domain: str) -> list[dict]:
    """Known coupon codes for a store domain (empty if none)."""
    entries = _coupons()
    d = normalize_domain(domain)
    return [{**c, "source": c.get("source", "static")} for c in entries.get(d, [])]
