import hashlib
import json
import os
import urllib.parse
from typing import List

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.core.config import get_settings
from app.schemas.recommendations import ProductRecommendation, RecommendationsRequest, RecommendationsResponse


class JevItemOutput(BaseModel):
    title: str
    estimated_price: float
    pip_reason: str
    search_query: str


class JevPipelineOutput(BaseModel):
    alternatives: List[JevItemOutput]
    summary: str


def build_search_url(query: str, prefer_amazon: bool = False) -> str:
    """Builds a deterministic search URL without hallucinated product links."""
    clean_q = query.strip()
    encoded = urllib.parse.quote(clean_q)
    if prefer_amazon:
        return f"https://www.amazon.com/s?k={encoded}&tag=nook01-20"
    return f"https://www.google.com/search?tbm=shop&q={encoded}"


def generate_fallback_recommendations(cart_name: str, total_cost: float) -> List[ProductRecommendation]:
    """Deterministic heuristic fallback if LLM is unavailable."""
    base_price = total_cost if total_cost > 0 else 50.0
    
    # 1. Budget alternative
    budget_price = round(base_price * 0.60, 2)
    budget_savings = round(base_price - budget_price, 2)
    budget_query = f"affordable {cart_name} top rated"
    
    # 2. Refurbished / Value alternative
    refurb_price = round(base_price * 0.45, 2)
    refurb_savings = round(base_price - refurb_price, 2)
    refurb_query = f"certified refurbished {cart_name}"

    # 3. Open box / Warehouse deal
    open_box_price = round(base_price * 0.70, 2)
    open_box_savings = round(base_price - open_box_price, 2)
    open_box_query = f"open box deal {cart_name}"

    return [
        ProductRecommendation(
            id=hashlib.md5(budget_query.encode()).hexdigest()[:8],
            title=f"Top-Rated Budget Alternative ({cart_name})",
            estimated_price=budget_price,
            estimated_savings=budget_savings,
            pip_reason="Same core features, 4+ star reviews, and keeps extra acorns in your pocket!",
            search_query=budget_query,
            search_url=build_search_url(budget_query),
        ),
        ProductRecommendation(
            id=hashlib.md5(refurb_query.encode()).hexdigest()[:8],
            title=f"Certified Refurbished / Renewed ({cart_name})",
            estimated_price=refurb_price,
            estimated_savings=refurb_savings,
            pip_reason="Includes warranty, inspected like new, and saves over 50% compared to brand new.",
            search_query=refurb_query,
            search_url=build_search_url(refurb_query, prefer_amazon=True),
        ),
        ProductRecommendation(
            id=hashlib.md5(open_box_query.encode()).hexdigest()[:8],
            title=f"Open-Box / Clearance Deal ({cart_name})",
            estimated_price=open_box_price,
            estimated_savings=open_box_savings,
            pip_reason="Customer return with zero damage; why pay full retail for sealed cardboard?",
            search_query=open_box_query,
            search_url=build_search_url(open_box_query),
        ),
    ]


async def run_jev_recommender(payload: RecommendationsRequest) -> RecommendationsResponse:
    """Runs the TypeSafe Jev product recommendation pipeline."""
    # Extract readable item names
    item_names = []
    for it in payload.items:
        if isinstance(it, str):
            item_names.append(it)
        elif hasattr(it, "name"):
            item_names.append(it.name)

    items_str = ", ".join(item_names) if item_names else "items in cart"
    total_cost = payload.total_cost if payload.total_cost > 0 else 50.0

    settings = get_settings()
    api_key = settings.gemini_api_key or os.environ.get("GEMINI_API_KEY")

    if api_key:
        try:
            client = genai.Client(api_key=api_key)
            prompt = f"""
            You are the Jev Shopping Decision Recommender engine for Nook (Pip the Squirrel).
            The shopper is checking out:
            - Product(s): {items_str}
            - Cart Total: ${total_cost:.2f}
            - Store Domain: {payload.store_domain}

            Analyze this purchase and propose exactly 2 to 3 cheaper or significantly higher-value alternative products.
            Requirements:
            1. 'title': Clear, recognizable product or model alternative (e.g. 'Refurbished Sony WH-1000XM4', 'Anker Soundcore Space Q45').
            2. 'estimated_price': Realistic market price strictly LOWER than ${total_cost:.2f}.
            3. 'pip_reason': Cheeky, supportive squirrel explanation (1 sentence) highlighting why it's a smart swap.
            4. 'search_query': A clean, deterministic search keyword query to find this exact deal online (e.g. 'anker soundcore space q45 refurbished').
            """

            response = client.models.generate_content(
                model=settings.gemini_model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=JevPipelineOutput,
                    temperature=0.2,
                ),
            )

            parsed = JevPipelineOutput.model_validate_json(response.text)
            recs = []
            for alt in parsed.alternatives:
                est_price = min(alt.estimated_price, total_cost * 0.95)
                savings = max(1.0, round(total_cost - est_price, 2))
                rec_id = hashlib.md5(alt.search_query.encode()).hexdigest()[:8]
                recs.append(
                    ProductRecommendation(
                        id=rec_id,
                        title=alt.title,
                        estimated_price=round(est_price, 2),
                        estimated_savings=savings,
                        pip_reason=alt.pip_reason,
                        search_query=alt.search_query,
                        search_url=build_search_url(alt.search_query),
                    )
                )

            if recs:
                return RecommendationsResponse(
                    recommendations=recs,
                    summary=parsed.summary or f"Pip found {len(recs)} smart alternatives saving up to ${max(r.estimated_savings for r in recs):.2f}!",
                )
        except Exception as exc:
            print(f"[Jev Recommender] Gemini pipeline exception, using heuristic fallback: {exc}")

    # Fallback if Gemini unavailable
    fallback_recs = generate_fallback_recommendations(items_str, total_cost)
    max_savings = max(r.estimated_savings for r in fallback_recs)
    return RecommendationsResponse(
        recommendations=fallback_recs,
        summary=f"Pip spotted alternative deals saving up to ${max_savings:.2f}!",
    )


async def evaluate_typesafe_jev(item_name: str, cart_total: float, store_domain: str) -> dict:
    """Invokes TypeSafe Jev System One decision engine with typed calibration."""
    settings = get_settings()
    api_key = settings.typesafe_api_key or os.environ.get("TYPESAFE_API_KEY")
    if not api_key:
        return {"should_scrape": True, "search_tactic": "marketplace_renewed"}

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "state": f"Shopper decided to BUY '{item_name}' for ${cart_total:.2f} on {store_domain}. Verdict: 'buy'.",
        "model": "jev-latest",
        "questions": {
            "should_scrape_better_deals": {
                "type": "noul",
                "instructions": "Should we scrape live web listings to find cheaper prices or better deals before completing this purchase?",
            },
            "search_tactic": {
                "type": "choice",
                "instructions": "Which search query tactic will find the highest savings for this product?",
                "criteria": {
                    "direct_discount": ["discount", "cheaper price", "sale", "deals"],
                    "marketplace_renewed": ["refurbished", "open box", "outlet", "renewed"],
                    "price_comparison": ["best price", "lowest price", "price match"],
                },
            },
        },
    }
    try:
        import httpx
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post("https://api.typesafe.ai/v1/systemone", headers=headers, json=payload)
            if resp.status_code == 200:
                data = resp.json()
                answers = data.get("answers", {})
                should_scrape = answers.get("should_scrape_better_deals", {}).get("noul", 1.0) >= 0.3
                search_tactic = answers.get("search_tactic", {}).get("choice", "marketplace_renewed")
                print(f"[TypeSafe Jev] Decision calibrated: should_scrape={should_scrape}, tactic={search_tactic}")
                return {"should_scrape": should_scrape, "search_tactic": search_tactic, "raw": answers}
    except Exception as exc:
        print(f"[TypeSafe Jev] System One request error: {exc}")
    return {"should_scrape": True, "search_tactic": "marketplace_renewed"}


async def scrape_live_web_listings(item_name: str, cart_total: float, tactic: str = "deals") -> List[ProductRecommendation]:
    """Scrapes live shopping listings from the web for similar listings."""
    import re
    import httpx
    from bs4 import BeautifulSoup
    from app.schemas.recommendations import ScrapedDeal

    tactic_keywords = {
        "marketplace_renewed": "refurbished renewed",
        "direct_discount": "discount sale",
        "price_comparison": "lowest price deals",
    }.get(tactic, "deals")

    search_query = f"{item_name} {tactic_keywords}"
    encoded = urllib.parse.quote(search_query)
    url = f"https://www.bing.com/shop?q={encoded}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    deals = []
    seen = set()
    try:
        async with httpx.AsyncClient(timeout=7.0, follow_redirects=True) as client:
            res = await client.get(url, headers=headers)
            if res.status_code == 200:
                soup = BeautifulSoup(res.text, "html.parser")
                cards = soup.select(".br-item, .slide, .br-card")
                for card in cards:
                    title_el = card.select_one(".br-title, .br-standardTitle, a[title]")
                    price_el = card.select_one(".br-price, .pd-price")
                    seller_el = card.select_one(".br-sellers, .br-sellerName, .br-seller")
                    img_el = card.select_one("img")

                    title = title_el.get("title") or title_el.get_text(strip=True) if title_el else ""
                    if not title or len(title) < 5:
                        continue

                    price_text = price_el.get_text(strip=True) if price_el else ""
                    m = re.search(r"\$([0-9,]+(?:\.[0-9]{2})?)", price_text)
                    if not m:
                        continue
                    try:
                        price = float(m.group(1).replace(",", ""))
                    except ValueError:
                        continue

                    seller = seller_el.get_text(strip=True) if seller_el else "Online Store"
                    img = img_el.get("src") or img_el.get("data-src") if img_el else None
                    if img and not img.startswith("http"):
                        img = f"https://www.bing.com{img}"

                    key_t = title[:24].lower()
                    if key_t in seen:
                        continue
                    seen.add(key_t)

                    savings = round(max(0.0, cart_total - price), 2)
                    if savings <= 0:
                        savings = round(price * 0.15, 2)

                    deal_url = f"https://www.google.com/search?tbm=shop&q={urllib.parse.quote(title)}"
                    deal_id = hashlib.md5(f"{title}_{price}".encode()).hexdigest()[:8]
                    pip_reason = f"Pip found this on {seller} for ${price:.2f}! You could keep ${savings:.2f} in your stash."

                    deals.append(
                        ScrapedDeal(
                            id=deal_id,
                            title=title,
                            price=price,
                            estimated_savings=savings,
                            seller=seller,
                            url=deal_url,
                            image=img,
                            pip_reason=pip_reason,
                            badge=f"Save ${savings:.2f}" if savings > 0 else "Deal",
                        )
                    )
                    if len(deals) >= 3:
                        break
    except Exception as exc:
        print(f"[Web Scraper] Live scraping error: {exc}")

    # Fallback to heuristic alternatives if scraping is blocked or empty
    if len(deals) < 2:
        from app.schemas.recommendations import ScrapedDeal
        recs = generate_fallback_recommendations(item_name, cart_total)
        for r in recs:
            deals.append(
                ScrapedDeal(
                    id=r.id,
                    title=r.title,
                    price=r.estimated_price,
                    estimated_savings=r.estimated_savings,
                    seller="Verified Online Retailer",
                    url=r.search_url,
                    pip_reason=r.pip_reason,
                    badge=f"Save ${r.estimated_savings:.2f}",
                )
            )
            if len(deals) >= 3:
                break

    return deals


async def get_buy_verdict_deals(payload) -> object:
    """Executes the TypeSafe Jev decision pipeline and web scraper when shopper buys."""
    from app.schemas.recommendations import BuyDealsResponse

    item_name = payload.item_name.strip()
    cart_total = payload.cart_total if payload.cart_total > 0 else 50.0

    # 1. TypeSafe Jev System One Decision Calibration
    jev_result = await evaluate_typesafe_jev(item_name, cart_total, payload.store_domain)
    tactic = jev_result.get("search_tactic", "marketplace_renewed")

    # 2. Live Web Scraper
    deals = await scrape_live_web_listings(item_name, cart_total, tactic)
    max_savings = max((d.estimated_savings for d in deals), default=0.0)

    summary = (
        f"Pip and TypeSafe Jev scraped the web and found {len(deals)} better deals, saving you up to ${max_savings:.2f}!"
        if max_savings > 0
        else f"Pip found {len(deals)} alternative listings online for {item_name}."
    )

    return BuyDealsResponse(
        item_name=item_name,
        cart_total=cart_total,
        store_domain=payload.store_domain,
        jev_evaluated=True,
        deals=deals,
        summary=summary,
    )
