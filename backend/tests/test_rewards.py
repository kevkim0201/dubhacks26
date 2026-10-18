import unittest
from app.core.rewards import calculate_decision_reward, get_tier_info, TIERS


class TestRewards(unittest.TestCase):
    def test_tier_info(self):
        self.assertEqual(get_tier_info(0), ("Baby", 250))
        self.assertEqual(get_tier_info(249), ("Baby", 250))
        self.assertEqual(get_tier_info(250), ("Scout", 1000))
        self.assertEqual(get_tier_info(999), ("Scout", 1000))
        self.assertEqual(get_tier_info(1000), ("Forager", 3000))
        self.assertEqual(get_tier_info(3000), ("Hoarder", 7500))
        self.assertEqual(get_tier_info(7500), ("Golden", None))
        self.assertEqual(get_tier_info(10000), ("Golden", None))

    def test_buy_reward(self):
        awarded, streak = calculate_decision_reward("buy", cart_total=100.0)
        self.assertEqual(awarded, 20)
        self.assertFalse(streak)

    def test_save_reward(self):
        awarded, streak = calculate_decision_reward("save", cart_total=100.0)
        self.assertEqual(awarded, 30)
        self.assertFalse(streak)

    def test_skip_reward_calculation(self):
        # $10 cart: 40 + floor(10/2) = 45 acorns
        awarded, streak = calculate_decision_reward("skip", cart_total=10.0)
        self.assertEqual(awarded, 45)
        self.assertFalse(streak)

        # $89 cart: 40 + floor(89/2) = 40 + 44 = 84 acorns
        awarded, _ = calculate_decision_reward("skip", cart_total=89.0)
        self.assertEqual(awarded, 84)

        # $500 cart: 40 + 250 = 290 -> capped at 150
        awarded, _ = calculate_decision_reward("skip", cart_total=500.0)
        self.assertEqual(awarded, 150)

    def test_streak_bonus(self):
        history = ["skip", "save"]
        awarded, streak = calculate_decision_reward(
            "skip", cart_total=20.0, recent_decisions=history
        )
        # Base: 40 + 10 = 50. Streak bonus: +25 => 75
        self.assertEqual(awarded, 75)
        self.assertTrue(streak)

    def test_daily_cap(self):
        # User already earned 280 acorns today; cap is 300
        awarded, _ = calculate_decision_reward("skip", cart_total=100.0, today_acorns=280)
        # Would be 40 + 50 = 90, but only 20 left
        self.assertEqual(awarded, 20)


if __name__ == "__main__":
    unittest.main()
