"""Try the deal agent from the terminal and watch it think.

    cd backend
    .venv/bin/python -m scripts.try_product '{"title": "Sony WH-1000XM5 Headphones", "price": 399.99, "url": "https://www.bestbuy.com/site/123"}'
    .venv/bin/python -m scripts.try_product https://www.bestbuy.com/site/123 --title "Sony WH-1000XM5" --price 399.99
    DEMO_MODE=1 .venv/bin/python -m scripts.try_product '{"title": "EchoPulse Sport Headphones", "price": 89, "url": "http://localhost:8000/demo/index.html#prod-headphones"}'

Runs in-process (no server needed) and uses backend/.env for keys.
"""

import argparse
import asyncio
import json
import sys
import time

from app.services.deal_agent.models import DealRequest
from app.services.deal_agent.service import hunt


def parse_args() -> DealRequest:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("product", help="DealRequest JSON, a path to a .json file, or a product URL")
    p.add_argument("--title")
    p.add_argument("--price", type=float)
    p.add_argument("--currency", default="USD")
    a = p.parse_args()
    if a.product.startswith(("http://", "https://")):
        if not a.title or a.price is None:
            p.error("with a URL, also pass --title and --price (the agent doesn't scrape pages)")
        return DealRequest(title=a.title, price=a.price, url=a.product, currency=a.currency)
    text = open(a.product).read() if a.product.endswith(".json") else a.product
    return DealRequest.model_validate_json(text)


async def main() -> None:
    req = parse_args()
    if req.price is None:
        sys.exit("price is required")
    t0 = time.monotonic()
    async for event in hunt(req):
        stamp = f"{time.monotonic() - t0:5.1f}s"
        if event["event"] == "step":
            print(f"{stamp}  🐿️  {event['data']['message']}")
        else:
            print(f"{stamp}  {event['event'].upper()}")
            print(json.dumps(event["data"], indent=2))


if __name__ == "__main__":
    asyncio.run(main())
