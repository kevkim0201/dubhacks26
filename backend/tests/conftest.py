import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

# Settings require a Supabase URL; tests never call it.
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.auth import CurrentUser, get_current_user  # noqa: E402
from app.main import app  # noqa: E402
from app.rewards import settle  # noqa: E402
from app.rewards.models import CheckoutSession, Item  # noqa: E402
from app.rewards.store import InMemoryStore  # noqa: E402
from app.routers import rewards  # noqa: E402


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def store() -> InMemoryStore:
    return InMemoryStore()


@pytest.fixture
def new_session(store, user_id):
    """Stand in for the conversation side: create a checkout session, return its id."""
    def make(name="Trailhead Hoodie", price=64.0, shop="pinecone.shop", user=None, reason=None) -> str:
        session = CheckoutSession(
            id=str(uuid4()), user_id=user or user_id["id"], store=shop,
            items=[Item(name=name, price=price)], cart_total=price, reason_summary=reason,
        )
        store.add_checkout_session(session)
        return session.id
    return make


@pytest.fixture
def user_id() -> dict:
    """Mutable so a test can switch who is signed in."""
    return {"id": "user-1"}


@pytest.fixture
def client(store, clock, user_id):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(id=user_id["id"], claims={})
    app.dependency_overrides[rewards.get_store] = lambda: store
    app.dependency_overrides[rewards.get_now] = lambda: clock.now
    app.dependency_overrides[rewards.get_timing] = lambda: settle.Timing()
    yield TestClient(app)
    app.dependency_overrides.clear()
