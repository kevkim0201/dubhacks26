"""Acorn rewards for checkout decisions.

    rules.py     how many acorns a decision is worth, caps, streaks, tiers
    matching.py  does a completed order match an earlier decision?
    settle.py    turns decisions + orders + time into acorns paid out
    store.py     storage (in-memory for now; Supabase later, same interface)

XP is `total_earned` (never goes down, decides the tier). Acorns are
`balance` (spendable). Every payout adds to both.
"""
