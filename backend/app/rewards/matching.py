"""Does a completed purchase match an earlier skip or saved item?

Matching is by store plus a similar item name. Pure functions, no I/O.
"""

import re
from difflib import SequenceMatcher

from app.rewards.models import Item

NAME_SIMILARITY = 0.8


def normalize_store(store: str) -> str:
    store = store.strip().lower()
    store = re.sub(r"^https?://", "", store)
    store = re.sub(r"^www\.", "", store)
    return store.split("/")[0]


def normalize_name(name: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", name.lower()).split())


def item_key(store: str, name: str) -> str:
    """Stable key stored in saved_items.item_key: "<store>|<item name>"."""
    return f"{normalize_store(store)}|{normalize_name(name)}"


def split_item_key(key: str) -> tuple[str, str]:
    store, _, name = key.partition("|")
    return store, name


def names_match(a: str, b: str) -> bool:
    a, b = normalize_name(a), normalize_name(b)
    if not a or not b:
        return False
    if a == b or a in b or b in a:  # "Trail Hoodie" vs "Trail Hoodie - Grey, M"
        return True
    return SequenceMatcher(None, a, b).ratio() >= NAME_SIMILARITY


def item_in(name: str, items: list[Item]) -> bool:
    return any(names_match(name, item.name) for item in items)


def same_store(a: str, b: str) -> bool:
    return normalize_store(a) == normalize_store(b)


def purchase_matches(purchase_store: str, purchase_items: list[Item], store: str, items: list[Item]) -> bool:
    """Same store, and at least one item in common."""
    if not same_store(purchase_store, store):
        return False
    return any(item_in(item.name, purchase_items) for item in items)


def purchase_matches_key(purchase_store: str, purchase_items: list[Item], key: str) -> bool:
    store, name = split_item_key(key)
    return same_store(purchase_store, store) and item_in(name, purchase_items)
