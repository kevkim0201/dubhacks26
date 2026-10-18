import pytest

from app.rewards import rules


def test_buy_and_save_are_flat_whatever_the_cart():
    assert rules.decision_reward("buy", 5) == 20
    assert rules.decision_reward("buy", 5000) == 20
    assert rules.decision_reward("save", 89.99) == 30


@pytest.mark.parametrize(
    ("cart_total", "acorns"),
    [
        (0, 40),
        (1.99, 40),      # less than $2 kept: no bonus yet
        (2, 41),
        (89.99, 84),     # 40 + 44
        (219.99, 149),
        (220, 150),
        (10_000, 150),   # capped
        (-5, 40),        # nonsense totals don't reduce the base
    ],
)
def test_skip_scales_with_money_kept_up_to_the_cap(cart_total, acorns):
    assert rules.decision_reward("skip", cart_total) == acorns


def test_unknown_decision_is_rejected():
    with pytest.raises(ValueError):
        rules.decision_reward("maybe", 10)


def test_streak_pays_on_the_third_non_buy_and_restarts():
    streak, bonuses = 0, []
    for decision in ["save", "skip", "skip", "save"]:
        streak, bonus = rules.next_streak(streak, decision)
        bonuses.append(bonus)
    assert bonuses == [0, 0, 25, 0]
    assert streak == 1


def test_buy_resets_the_streak():
    assert rules.next_streak(2, "buy") == (0, 0)


def test_daily_cap_pays_only_what_is_left_today():
    assert rules.capped_amount(150, 0) == 150
    assert rules.capped_amount(150, 250) == 50
    assert rules.capped_amount(20, 300) == 0
    assert rules.capped_amount(20, 999) == 0


@pytest.mark.parametrize(
    ("total", "name", "next_at"),
    [(0, "Baby", 250), (249, "Baby", 250), (250, "Scout", 1000), (999, "Scout", 1000),
     (1000, "Forager", 3000), (7499, "Hoarder", 7500), (7500, "Golden", None), (99_999, "Golden", None)],
)
def test_tiers(total, name, next_at):
    info = rules.tier_for(total)
    assert (info.name, info.next_at) == (name, next_at)


def test_tier_up_only_when_a_threshold_is_crossed():
    assert rules.tier_up(980, 1000) is True
    assert rules.tier_up(980, 999) is False
    assert rules.tier_up(1000, 1020) is False
