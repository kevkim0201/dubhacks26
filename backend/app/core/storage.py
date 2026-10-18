from __future__ import annotations

import time
import uuid
from typing import Any

from app.core.rewards import calculate_decision_reward, get_tier_info


class MemoryStorage:
    def __init__(self) -> None:
        self.users: dict[str, dict[str, Any]] = {}
        self.decisions: list[dict[str, Any]] = []
        self.sessions: dict[str, dict[str, Any]] = {}

    def get_or_create_user(self, user_id: str = "demo_user") -> dict[str, Any]:
        if user_id not in self.users:
            self.users[user_id] = {
                "id": user_id,
                "total_earned": 0,
                "balance": 0,
                "streak": 0,
                "today_acorns": 0,
                "last_active_day": time.strftime("%Y-%m-%d"),
            }
        return self.users[user_id]

    def seed_user(
        self,
        user_id: str = "demo_user",
        total_earned: int = 980,
        balance: int | None = None,
    ) -> dict[str, Any]:
        user = self.get_or_create_user(user_id)
        user["total_earned"] = total_earned
        user["balance"] = balance if balance is not None else total_earned
        return self.get_user_state(user_id)

    def get_user_state(self, user_id: str = "demo_user") -> dict[str, Any]:
        user = self.get_or_create_user(user_id)
        tier_name, next_threshold = get_tier_info(user["total_earned"])

        # Recent decisions for this user
        user_decisions = [
            d for d in reversed(self.decisions) if d.get("user_id") == user_id
        ][:10]

        return {
            "user_id": user_id,
            "total_earned": user["total_earned"],
            "balance": user["balance"],
            "tier": tier_name,
            "next_tier_at": next_threshold,
            "streak": user["streak"],
            "recent_decisions": user_decisions,
        }

    def create_session(
        self, cart: dict[str, Any], user_id: str = "demo_user"
    ) -> dict[str, Any]:
        session_id = f"sess_{uuid.uuid4().hex[:12]}"
        session_data = {
            "session_id": session_id,
            "user_id": user_id,
            "cart": cart,
            "turns": [],
            "status": "active",
            "created_at": time.time(),
        }
        self.sessions[session_id] = session_data
        return session_data

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        return self.sessions.get(session_id)

    def add_turn(
        self, session_id: str, user_text: str, reply_text: str
    ) -> dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        turn_entry = {
            "turn_index": len(session["turns"]) + 1,
            "user_text": user_text,
            "reply_text": reply_text,
            "timestamp": time.time(),
        }
        session["turns"].append(turn_entry)
        return turn_entry

    def apply_decision(
        self, session_id: str, decision: str
    ) -> dict[str, Any]:
        session = self.get_session(session_id)
        if not session:
            raise ValueError(f"Session {session_id} not found")

        user_id = session.get("user_id", "demo_user")
        user = self.get_or_create_user(user_id)

        # Reset daily acorns if date rolled over
        today = time.strftime("%Y-%m-%d")
        if user["last_active_day"] != today:
            user["today_acorns"] = 0
            user["last_active_day"] = today

        cart = session.get("cart", {})
        cart_total = float(cart.get("total", 0.0))

        # Recent decisions
        recent_history = [
            d["decision"]
            for d in reversed(self.decisions)
            if d.get("user_id") == user_id
        ][:5]

        # Calculate rewards
        old_tier, _ = get_tier_info(user["total_earned"])
        acorns_awarded, streak_bonus = calculate_decision_reward(
            decision=decision,  # type: ignore[arg-type]
            cart_total=cart_total,
            recent_decisions=recent_history,
            today_acorns=user["today_acorns"],
        )

        # Update streak
        if decision in ("skip", "save"):
            user["streak"] += 1
        else:
            user["streak"] = 0

        # Update balances
        user["total_earned"] += acorns_awarded
        user["balance"] += acorns_awarded
        user["today_acorns"] += acorns_awarded

        new_tier, _ = get_tier_info(user["total_earned"])
        tier_up = new_tier != old_tier

        # Record decision
        decision_record = {
            "id": f"dec_{uuid.uuid4().hex[:10]}",
            "session_id": session_id,
            "user_id": user_id,
            "store": cart.get("store", "mock-store"),
            "items": cart.get("items", []),
            "cart_total": cart_total,
            "decision": decision,
            "acorns": acorns_awarded,
            "status": "completed",
            "streak_bonus": streak_bonus,
            "created_at": time.time(),
        }
        self.decisions.append(decision_record)
        session["status"] = "completed"

        return {
            "acorns_awarded": acorns_awarded,
            "status": "completed",
            "total_earned": user["total_earned"],
            "balance": user["balance"],
            "tier": new_tier,
            "tier_up": tier_up,
            "streak": user["streak"],
            "decision_record": decision_record,
        }


# Singleton instance for application lifecycle
db = MemoryStorage()
