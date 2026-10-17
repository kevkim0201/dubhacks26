import json
import re
import urllib.parse
from typing import List, Optional
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(
    title="DubHacks26 Real Coupon API",
    description="Live coupon extraction service powered by Honey store resolution and public store feeds",
    version="1.0.0",
)

# Enable CORS for browser extensions and local testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HONEY_GRAPHQL_URL = "https://d.joinhoney.com/v3"
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Service-Name": "honey-extension",
    "Service-Version": "19.7.0",
    "Accept": "application/json",
}


class CouponItem(BaseModel):
    id: str
    store: str
    code: str
    description: Optional[str] = None
    discount_type: str = "unknown"  # 'percent' | 'fixed' | 'shipping' | 'unknown'
    discount_value: Optional[float] = None
    min_cart: float = 0.0
    confidence: float = 0.8
    source: str = "live-network"


class CouponResponse(BaseModel):
    success: bool
    domain: str
    store_name: Optional[str] = None
    store_id: Optional[str] = None
    total_coupons: int
    coupons: List[CouponItem]


def parse_domain_from_url(url_or_domain: str) -> str:
    """Normalizes a raw domain or URL down to its root merchant domain."""
    cleaned = url_or_domain.strip().lower()
    if "://" not in cleaned:
        cleaned = "https://" + cleaned
    try:
        parsed = urllib.parse.urlparse(cleaned)
        hostname = parsed.hostname or url_or_domain
        hostname = re.sub(r"^www\.", "", hostname)
        return hostname
    except Exception:
        return re.sub(r"^www\.", "", url_or_domain.lower())


def extract_discount_info(description: str):
    """Heuristic helper to parse discount type and value from description text."""
    if not description:
        return "unknown", None

    desc_lower = description.lower()
    if "free shipping" in desc_lower or "freeship" in desc_lower:
        return "shipping", 0.0

    percent_match = re.search(r"(\d+(?:\.\d+)?)\s*%", desc_lower)
    if percent_match:
        return "percent", float(percent_match.group(1))

    dollar_match = re.search(r"\$\s*(\d+(?:\.\d+)?)", desc_lower)
    if dollar_match:
        return "fixed", float(dollar_match.group(1))

    return "unknown", None


def select_best_partial(partials: List[dict], domain: str, full_url: Optional[str]) -> str:
    """Selects the best storeId using exact domain / longest path matching."""
    if not partials:
        return ""

    # 1. If full url is provided, check if any partial URL matches the full path
    if full_url:
        clean_url = full_url.lower()
        for p in partials:
            p_url = p.get("partialURL", "").lower()
            if p_url and p_url in clean_url:
                return str(p.get("storeId"))

    # 2. Check for exact root domain match (e.g. partialURL == "nike.com")
    for p in partials:
        p_url = p.get("partialURL", "").lower().strip("/")
        if p_url == domain.lower().strip("/"):
            return str(p.get("storeId"))

    # 3. Default to first partial
    return str(partials[0].get("storeId"))


@app.get("/api/coupons", response_model=CouponResponse)
async def get_live_coupons(
    domain: Optional[str] = Query(None, description="Domain or store URL, e.g. target.com"),
    url: Optional[str] = Query(None, description="Full checkout or product URL"),
):
    target = url or domain
    if not target:
        raise HTTPException(status_code=400, detail="Missing required 'domain' or 'url' query parameter")

    clean_domain = parse_domain_from_url(target)

    async with httpx.AsyncClient(timeout=10.0, headers=DEFAULT_HEADERS) as client:
        # Step 1: Query store partials for domain
        var_str1 = json.dumps({"domain": clean_domain})
        partials_url = f"{HONEY_GRAPHQL_URL}?operationName=ext_getStorePartialsByDomain&variables={urllib.parse.quote(var_str1)}"
        resp1 = await client.get(partials_url)
        if resp1.status_code != 200:
            raise HTTPException(status_code=resp1.status_code, detail="Failed to query store resolution service")

        data1 = resp1.json()
        partials = data1.get("data", {}).get("getPartialURLsByDomain", [])
        if not partials:
            return CouponResponse(
                success=True,
                domain=clean_domain,
                store_name=clean_domain.capitalize(),
                store_id=None,
                total_coupons=0,
                coupons=[],
            )

        store_id = select_best_partial(partials, clean_domain, url)

        # Step 2: Query full store metadata and live coupon codes
        var_str2 = json.dumps({"storeId": store_id})
        store_url = f"{HONEY_GRAPHQL_URL}?operationName=ext_v2_getStoreById&variables={urllib.parse.quote(var_str2)}"
        resp2 = await client.get(store_url)
        if resp2.status_code != 200:
            raise HTTPException(status_code=resp2.status_code, detail="Failed to query store coupon details")

        data2 = resp2.json()
        store_obj = data2.get("data", {}).get("getStoreById", {})
        store_name = store_obj.get("name") or clean_domain.capitalize()

        raw_coupons = (store_obj.get("publicCoupons") or []) + (store_obj.get("ugc") or [])
        formatted_coupons: List[CouponItem] = []

        seen_codes = set()
        for idx, c in enumerate(raw_coupons):
            code = (c.get("code") or "").strip().upper()
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)

            desc = c.get("description") or ""
            disc_type, disc_val = extract_discount_info(desc)
            rank = float(c.get("rank") or 0.8)
            confidence = min(max(round(rank if rank <= 1.0 else rank / 100.0, 2), 0.5), 0.99)

            formatted_coupons.append(
                CouponItem(
                    id=f"{clean_domain}-{idx}-{code}",
                    store=clean_domain,
                    code=code,
                    description=desc if desc else f"Save on {store_name}",
                    discount_type=disc_type,
                    discount_value=disc_val,
                    min_cart=0.0,
                    confidence=confidence,
                    source="honey-live-network",
                )
            )

        return CouponResponse(
            success=True,
            domain=clean_domain,
            store_name=store_name,
            store_id=store_id,
            total_coupons=len(formatted_coupons),
            coupons=formatted_coupons,
        )


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "dubhacks26-coupon-api"}
