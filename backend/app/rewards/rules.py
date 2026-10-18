"""Reward amounts and tiers from the design doc. Pure functions, no I/O.

Starting values to tune during testing -- change them here only.
"""

from dataclasses import dataclass
from typing import Literal

Decision = Literal["buy", "save", "skip"]

BUY_ACORNS = 20
SAVE_ACORNS = 30
SAVE_BONUS_ACORNS = 20      # saved item bought after the wait
SKIP_BASE_ACORNS = 40
SKIP_DOLLARS_PER_ACORN = 2  # +1 acorn per $2 kept
SKIP_MAX_ACORNS = 150       # cap on the whole skip reward

STREAK_LENGTH = 3           # decisions in a row that weren't an immediate buy
STREAK_BONUS_ACORNS = 25

DAILY_CAP = 300

# (name, total_xp needed). Ordered, starting at 0.
# Must match the generated `tier` column in supabase/schema.sql.
TIERS: tuple[tuple[str, int], ...] = (
    ("Baby", 0),
    ("Scout", 250),
    ("Forager", 1000),
    ("Hoarder", 3000),
    ("Golden", 7500),
)


def decision_reward(decision: Decision, cart_total: float) -> int:
    """Acorns a decision is worth, before streak bonus and daily cap."""
    if decision == "buy":
        return BUY_ACORNS
    if decision == "save":
        return SAVE_ACORNS
    if decision == "skip":
        kept_bonus = int(max(0.0, cart_total) // SKIP_DOLLARS_PER_ACORN)
        return min(SKIP_BASE_ACORNS + kept_bonus, SKIP_MAX_ACORNS)
    raise ValueError(f"unknown decision: {decision!r}")


def next_streak(streak: int, decision: Decision) -> tuple[int, int]:
    """Returns (new streak, bonus acorns earned by this decision).

    Save and skip extend the streak; buy resets it. Hitting STREAK_LENGTH
    pays the bonus and starts counting again.
    """
    if decision == "buy":
        return 0, 0
    streak += 1
    if streak >= STREAK_LENGTH:
        return 0, STREAK_BONUS_ACORNS
    return streak, 0


def capped_amount(amount: int, earned_today: int) -> int:
    """How much of `amount` can be paid when `earned_today` was already paid today."""
    return max(0, min(amount, DAILY_CAP - earned_today))


@dataclass(frozen=True)
class TierInfo:
    name: str
    index: int
    floor: int                  # total_xp where this tier starts
    next_name: str | None       # None at the top tier
    next_at: int | None


def tier_for(total_xp: int) -> TierInfo:
    index = 0
    for i, (_, needed) in enumerate(TIERS):
        if total_xp >= needed:
            index = i
    name, floor = TIERS[index]
    next_name, next_at = TIERS[index + 1] if index + 1 < len(TIERS) else (None, None)
    return TierInfo(name=name, index=index, floor=floor, next_name=next_name, next_at=next_at)


def tier_up(total_before: int, total_after: int) -> bool:
    return tier_for(total_after).index > tier_for(total_before).index
