from typing import Literal

TIERS: list[tuple[str, int]] = [
    ("Baby", 0),
    ("Scout", 250),
    ("Forager", 1000),
    ("Hoarder", 3000),
    ("Golden", 7500),
]

DAILY_CAP = 300
DecisionType = Literal["buy", "save", "skip"]


def get_tier_info(total_earned: int) -> tuple[str, int | None]:
    """
    Returns (current_tier_name, next_tier_threshold).
    If at or above the highest tier, next_tier_threshold is None.
    """
    current_tier = "Baby"
    next_threshold: int | None = 250

    for idx, (tier_name, min_xp) in enumerate(TIERS):
        if total_earned >= min_xp:
            current_tier = tier_name
            if idx + 1 < len(TIERS):
                next_threshold = TIERS[idx + 1][1]
            else:
                next_threshold = None
        else:
            break

    return current_tier, next_threshold


def calculate_decision_reward(
    decision: DecisionType,
    cart_total: float,
    recent_decisions: list[str] | None = None,
    today_acorns: int = 0,
) -> tuple[int, bool]:
    """
    Calculates acorn rewards for a checkout decision:
    - Skip: 40 + floor(cart_total / 2), capped at 150
    - Save: 30
    - Buy: 20
    - Streak bonus: +25 if the last 2 decisions were 'skip' or 'save'
    - Daily cap: max 300 acorns per day

    Returns:
    (acorns_awarded, streak_bonus_awarded)
    """
    if recent_decisions is None:
        recent_decisions = []

    # 1. Base acorn reward
    if decision == "skip":
        kept_bonus = int(cart_total // 2)
        base = 40 + kept_bonus
        reward = min(base, 150)
    elif decision == "save":
        reward = 30
    elif decision == "buy":
        reward = 20
    else:
        reward = 0

    # 2. Streak check (+25 for 3 thoughtful non-immediate-buy decisions in a row)
    streak_bonus = False
    if decision in ("skip", "save"):
        # Check last 2 decisions
        if len(recent_decisions) >= 2:
            last_two = recent_decisions[-2:]
            if all(d in ("skip", "save") for d in last_two):
                reward += 25
                streak_bonus = True

    # 3. Enforce daily cap
    available_today = max(0, DAILY_CAP - today_acorns)
    awarded = min(reward, available_today)

    return awarded, streak_bonus
