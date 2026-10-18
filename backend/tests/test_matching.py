from app.rewards.matching import (
    item_key,
    names_match,
    normalize_store,
    purchase_matches,
    purchase_matches_key,
    split_item_key,
)
from app.rewards.models import Item


def items(*names):
    return [Item(name=n, price=50) for n in names]


def test_store_names_are_normalized():
    assert normalize_store("https://www.Pinecone.shop/checkout") == "pinecone.shop"


def test_item_key_is_stable_and_splits_back():
    key = item_key("www.Pinecone.shop", "Trailhead Hoodie (Grey)")
    assert key == "pinecone.shop|trailhead hoodie grey"
    assert split_item_key(key) == ("pinecone.shop", "trailhead hoodie grey")


def test_names_match_ignores_case_punctuation_and_variants():
    assert names_match("Trailhead Hoodie", "trailhead hoodie")
    assert names_match("Trailhead Hoodie", "Trailhead Hoodie - Grey, M")
    assert names_match("Trail-head hoodie", "Trailhead hoodie")
    assert not names_match("Trailhead Hoodie", "Gym Headphones")
    assert not names_match("", "Hoodie")


def test_purchase_matches_same_store_and_a_shared_item():
    assert purchase_matches("pinecone.shop", items("Socks", "Trailhead Hoodie (Grey)"),
                            "www.pinecone.shop", items("Trailhead Hoodie"))


def test_purchase_does_not_match_other_store_or_item():
    assert not purchase_matches("other.shop", items("Trailhead Hoodie"), "pinecone.shop", items("Trailhead Hoodie"))
    assert not purchase_matches("pinecone.shop", items("Gym Headphones"), "pinecone.shop", items("Trailhead Hoodie"))


def test_purchase_matches_a_saved_item_key():
    key = item_key("pinecone.shop", "Trailhead Hoodie")
    assert purchase_matches_key("pinecone.shop", items("Trailhead Hoodie - Grey"), key)
    assert not purchase_matches_key("other.shop", items("Trailhead Hoodie"), key)
