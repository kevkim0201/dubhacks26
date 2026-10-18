import unittest
from fastapi.testclient import TestClient
from app.main import app
from app.core.storage import db


class TestApiEndpoints(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        db.users.clear()
        db.decisions.clear()
        db.sessions.clear()

    def test_health_check(self):
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)

    def test_user_state_and_seed(self):
        # 1. Check initial user state
        resp = self.client.get("/user/state?user_id=test_judge")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["total_earned"], 0)
        self.assertEqual(data["tier"], "Baby")
        self.assertEqual(data["next_tier_at"], 250)

        # 2. Seed user to 980 XP
        seed_resp = self.client.post(
            "/user/seed", json={"user_id": "test_judge", "total_earned": 980}
        )
        self.assertEqual(seed_resp.status_code, 200)
        seed_data = seed_resp.json()
        self.assertEqual(seed_data["total_earned"], 980)
        self.assertEqual(seed_data["tier"], "Scout")
        self.assertEqual(seed_data["next_tier_at"], 1000)

    def test_checkout_full_flow(self):
        # Seed user just below Forager (1,000 XP)
        self.client.post("/user/seed", json={"user_id": "demo_shopper", "total_earned": 980})

        # 1. Start checkout session
        cart_payload = {
            "user_id": "demo_shopper",
            "cart": {
                "store": "acorn-outfitters.com",
                "items": [
                    {"name": "EchoPulse Sport Headphones", "price": 89.0, "qty": 1}
                ],
                "total": 89.0,
            },
        }
        start_resp = self.client.post("/checkout/start", json=cart_payload)
        self.assertEqual(start_resp.status_code, 200)
        start_data = start_resp.json()
        self.assertIn("session_id", start_data)
        self.assertIn("EchoPulse Sport Headphones", start_data["opening_line"])
        session_id = start_data["session_id"]

        # 2. Conversation Turn
        turn_resp = self.client.post(
            "/checkout/turn",
            json={"session_id": session_id, "user_text": "I need these for the gym!"},
        )
        self.assertEqual(turn_resp.status_code, 200)
        turn_data = turn_resp.json()
        self.assertTrue(len(turn_data["reply_text"]) > 0)
        self.assertTrue(turn_data["done"])

        # 3. Decision: User decides to skip
        # Reward for $89 skip: 40 + floor(89/2) = 40 + 44 = 84 acorns
        # Total: 980 + 84 = 1064 XP (crosses 1000 -> tier_up = True)
        dec_resp = self.client.post(
            "/checkout/decision",
            json={"session_id": session_id, "decision": "skip"},
        )
        self.assertEqual(dec_resp.status_code, 200)
        dec_data = dec_resp.json()
        self.assertEqual(dec_data["acorns_awarded"], 84)
        self.assertEqual(dec_data["total_earned"], 1064)
        self.assertEqual(dec_data["tier"], "Forager")
        self.assertTrue(dec_data["tier_up"])

        # 4. User state updated
        final_state = self.client.get("/user/state?user_id=demo_shopper").json()
        self.assertEqual(final_state["total_earned"], 1064)
        self.assertEqual(final_state["tier"], "Forager")
        self.assertEqual(len(final_state["recent_decisions"]), 1)


if __name__ == "__main__":
    unittest.main()
