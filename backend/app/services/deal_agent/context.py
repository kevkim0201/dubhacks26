"""Per-request state shared by the tools and the verifier."""

from dataclasses import dataclass, field


@dataclass
class AgentContext:
    currency: str = "USD"
    # Every offer a tool returned, by the short id the model refers to ("o1", "o2", ...).
    offers: dict[str, dict] = field(default_factory=dict)
    seen_links: set[str] = field(default_factory=set)
    queries: list[str] = field(default_factory=list)
    coupons: dict[str, list[dict]] = field(default_factory=dict)
    tool_calls: int = 0

    def remember(self, offer: dict) -> str:
        offer_id = f"o{len(self.offers) + 1}"
        self.offers[offer_id] = {**offer, "offer_id": offer_id}
        self.seen_links.add(offer["link"])
        return offer_id
