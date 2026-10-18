"""Personal weekly quests and your personal forest: the rules.

Pure functions, no I/O -- the routers fetch data and call these.

Quests: each week (Monday, UTC) a user gets 3 of the 4 quest types. Each
type has a ladder: completing one raises that type's target (and reward)
the next time it comes up. Progress is counted from the week's decisions.

Forest: 100 acorns plant a tree, 30 trees complete a forest, and each
completed forest is a $5 pledged donation.
"""

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Literal

QuestType = Literal["talk", "follow", "pause", "kept"]
QUEST_TYPES: tuple[QuestType, ...] = ("talk", "follow", "pause", "kept")
QUESTS_PER_WEEK = 3

# Targets by level (level 1 = first time). The last rung repeats.
LADDERS: dict[QuestType, tuple[int, ...]] = {
    "talk": (1, 3, 5, 7, 10),        # checkouts talked through with Pip
    "follow": (1, 2, 4, 6, 8),       # times the user did what Pip suggested
    "pause": (1, 2, 3, 5, 7),        # checkouts saved or skipped instead of bought
    "kept": (10, 20, 40, 60, 100),   # dollars kept by skipping
}
REWARDS: tuple[int, ...] = (30, 40, 50, 65, 80)  # acorns (and XP) by level

TREE_COST = 100
TREES_PER_FOREST = 30
DOLLARS_PER_FOREST = 5


@dataclass(frozen=True)
class QuestPlan:
    slot: int
    quest_type: QuestType
    level: int
    target: int
    reward_acorns: int


def week_start(today: date) -> date:
    """Monday of the week containing `today` (weeks run Monday-Sunday)."""
    return today - timedelta(days=today.weekday())


def types_for_week(monday: date) -> tuple[QuestType, ...]:
    """3 of the 4 types, rotating which one sits out each week."""
    resting = QUEST_TYPES[(monday.toordinal() // 7) % len(QUEST_TYPES)]
    return tuple(t for t in QUEST_TYPES if t != resting)


def target_for(quest_type: QuestType, level: int) -> int:
    ladder = LADDERS[quest_type]
    return ladder[min(level, len(ladder)) - 1]


def reward_for(level: int) -> int:
    return REWARDS[min(level, len(REWARDS)) - 1]


def plan_week(monday: date, claimed_counts: dict[str, int]) -> list[QuestPlan]:
    """This week's quests. A type's level is 1 + how many of it were claimed before."""
    plans = []
    for slot, quest_type in enumerate(types_for_week(monday), start=1):
        level = 1 + claimed_counts.get(quest_type, 0)
        plans.append(QuestPlan(slot, quest_type, level, target_for(quest_type, level), reward_for(level)))
    return plans


def progress(quest_type: str, decisions: list[dict[str, Any]]) -> Decimal:
    """How far the user got this week, from that week's decisions."""
    if quest_type == "talk":
        return Decimal(len(decisions))
    if quest_type == "follow":
        return Decimal(sum(1 for d in decisions if d.get("recommendation_matched")))
    if quest_type == "pause":
        return Decimal(sum(1 for d in decisions if d.get("decision") in ("save", "skip")))
    if quest_type == "kept":
        return sum(
            (Decimal(str(d.get("cart_total") or 0)) for d in decisions if d.get("decision") == "skip"),
            Decimal(0),
        )
    raise ValueError(f"unknown quest type: {quest_type!r}")


def describe(quest_type: str, target: int) -> dict[str, str]:
    plural = "" if target == 1 else "s"
    return {
        "talk": {"title": f"Talk to Pip before {target} checkout{plural}",
                 "hint": "Every conversation with Pip counts, whatever you decide."},
        "follow": {"title": f"Follow Pip's advice {target} time{plural}",
                   "hint": "Do what Pip suggests: buy, save for later or skip."},
        "pause": {"title": f"Pause on {target} checkout{plural}",
                  "hint": "Save for later or skip instead of buying right away."},
        "kept": {"title": f"Keep ${target} from impulse buys",
                 "hint": "Carts you skip add up toward this."},
    }[quest_type]


def forest_summary(total_trees: int) -> dict[str, int]:
    forests = total_trees // TREES_PER_FOREST
    return {
        "trees": total_trees,
        "forests": forests,
        "trees_in_current_forest": total_trees % TREES_PER_FOREST,
        "trees_per_forest": TREES_PER_FOREST,
        "tree_cost": TREE_COST,
        "dollars_pledged": forests * DOLLARS_PER_FOREST,
    }


def display_name(claims: dict[str, Any]) -> str:
    """First name + last initial from the sign-in profile, e.g. "Deetya K.".

    Never derived from the email address, since the leaderboard is public
    to other users.
    """
    meta = claims.get("user_metadata") or {}
    full = str(meta.get("full_name") or meta.get("name") or "").strip()
    if not full:
        return "Forager"
    parts = full.split()
    name = parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0].upper()}."
    return name[:60]
