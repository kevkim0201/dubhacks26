from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.services import quests as rules

MONDAY = date(2026, 10, 12)


def test_week_starts_on_monday():
    assert rules.week_start(date(2026, 10, 12)) == MONDAY
    assert rules.week_start(date(2026, 10, 18)) == MONDAY       # Sunday
    assert rules.week_start(date(2026, 10, 19)) == date(2026, 10, 19)


def test_three_of_four_types_each_week_and_they_rotate():
    weeks = [rules.types_for_week(MONDAY + timedelta(weeks=i)) for i in range(4)]
    assert all(len(set(w)) == 3 for w in weeks)
    resting = [next(t for t in rules.QUEST_TYPES if t not in w) for w in weeks]
    assert sorted(resting) == sorted(rules.QUEST_TYPES)  # each type sits out once in 4 weeks


@pytest.mark.parametrize(("quest_type", "targets"), [
    ("talk", [1, 3, 5, 7, 10, 10]),
    ("follow", [1, 2, 4, 6, 8, 8]),
    ("pause", [1, 2, 3, 5, 7, 7]),
    ("kept", [10, 20, 40, 60, 100, 100]),
])
def test_targets_climb_with_level_then_hold(quest_type, targets):
    assert [rules.target_for(quest_type, level) for level in range(1, 7)] == targets


def test_rewards_climb_with_level_then_hold():
    assert [rules.reward_for(level) for level in range(1, 7)] == [30, 40, 50, 65, 80, 80]


def test_plan_week_levels_up_types_already_claimed():
    plans = rules.plan_week(MONDAY, {"talk": 1, "kept": 4})
    by_type = {p.quest_type: p for p in plans}
    assert [p.slot for p in plans] == [1, 2, 3]
    if "talk" in by_type:
        assert (by_type["talk"].level, by_type["talk"].target, by_type["talk"].reward_acorns) == (2, 3, 40)
    if "kept" in by_type:
        assert (by_type["kept"].level, by_type["kept"].target) == (5, 100)
    for p in plans:
        if p.quest_type in ("follow", "pause"):
            assert p.level == 1


def test_progress_counts_the_right_decisions():
    decisions = [
        {"decision": "buy", "recommendation_matched": True, "cart_total": "50.00"},
        {"decision": "skip", "recommendation_matched": True, "cart_total": "64.00"},
        {"decision": "save", "recommendation_matched": False, "cart_total": "30.00"},
        {"decision": "skip", "recommendation_matched": False, "cart_total": "12.50"},
    ]
    assert rules.progress("talk", decisions) == 4
    assert rules.progress("follow", decisions) == 2
    assert rules.progress("pause", decisions) == 3
    assert rules.progress("kept", decisions) == Decimal("76.50")
    assert rules.progress("kept", []) == 0


def test_unknown_quest_type_is_rejected():
    with pytest.raises(ValueError):
        rules.progress("dance", [])


def test_descriptions_read_naturally():
    assert rules.describe("talk", 1)["title"] == "Talk to Pip before 1 checkout"
    assert rules.describe("talk", 3)["title"] == "Talk to Pip before 3 checkouts"
    assert rules.describe("kept", 20)["title"] == "Keep $20 from impulse buys"


@pytest.mark.parametrize(("trees", "forests", "current", "dollars"), [
    (0, 0, 0, 0), (29, 0, 29, 0), (30, 1, 0, 5), (65, 2, 5, 10),
])
def test_forest_math(trees, forests, current, dollars):
    s = rules.forest_summary(trees)
    assert (s["forests"], s["trees_in_current_forest"], s["dollars_pledged"]) == (forests, current, dollars)


def test_leaderboard_name_is_first_name_and_initial_never_email():
    assert rules.display_name({"user_metadata": {"full_name": "Deetya Kamat"}}) == "Deetya K."
    assert rules.display_name({"user_metadata": {"name": "Pip"}}) == "Pip"
    assert rules.display_name({"user_metadata": {}, "email": "dkamat2005@gmail.com"}) == "Forager"
    assert rules.display_name({}) == "Forager"
