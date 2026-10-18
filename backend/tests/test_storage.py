import unittest
from app.core.storage import MemoryStorage


class TestMemoryStorage(unittest.TestCase):
    def setUp(self):
        self.db = MemoryStorage()

    def test_user_creation_and_state(self):
        state = self.db.get_user_state("alice")
        self.assertEqual(state["user_id"], "alice")
        self.assertEqual(state["total_earned"], 0)
        self.assertEqual(state["balance"], 0)
        self.assertEqual(state["tier"], "Baby")
        self.assertEqual(state["next_tier_at"], 250)

    def test_seed_user(self):
        state = self.db.seed_user("bob", total_earned=980)
        self.assertEqual(state["total_earned"], 980)
        self.assertEqual(state["balance"], 980)
        self.assertEqual(state["tier"], "Scout")
        self.assertEqual(state["next_tier_at"], 1000)

    def test_checkout_decision_and_tier_evolution(self):
        # Seed user just below Forager (1,000 XP)
        self.db.seed_user("charlie", total_earned=980)

        # Create session with $89 cart
        cart = {
            "store": "acorn-outfitters.com",
            "items": [{"name": "EchoPulse Sport Headphones", "price": 89.0, "qty": 1}],
            "total": 89.0,
        }
        session = self.db.create_session(cart, user_id="charlie")
        sess_id = session["session_id"]

        # User decides to "skip": 40 + floor(89/2) = 84 acorns
        result = self.db.apply_decision(sess_id, "skip")

        self.assertEqual(result["acorns_awarded"], 84)
        self.assertEqual(result["total_earned"], 980 + 84)  # 1064
        self.assertEqual(result["tier"], "Forager")
        self.assertTrue(result["tier_up"])  # Scout -> Forager evolution triggered!

        # State reflects update
        updated_state = self.db.get_user_state("charlie")
        self.assertEqual(updated_state["total_earned"], 1064)
        self.assertEqual(updated_state["tier"], "Forager")
        self.assertEqual(len(updated_state["recent_decisions"]), 1)


if __name__ == "__main__":
    unittest.main()
