# Supabase database

`schema.sql` creates the initial backend tables and policies for Squirrel Savings.
Run it in the Supabase SQL Editor for a new project.

## What the tables hold

- `profiles`: one row per Supabase Auth user. `total_xp` is lifetime progression
  and determines the generated `tier`; `acorn_balance` is the spendable balance.
- `checkout_sessions`: cart snapshot plus the conversation assessment and
  suggestion. Conversation transcripts are intentionally not stored.
- `decisions`: decision history and reward ledger. Skips can remain `pending`
  until their seven-day `available_at`; the backend should set `locked_at` or
  `cancelled_at` when resolving a pending decision.
- `saved_items`: per-item waiting state for purchase detection and the 48-hour
  bonus eligibility window.
- `cosmetics` and `user_cosmetics`: shop catalog and user unlocks.

## Security and application writes

The schema enables row-level security and allows authenticated users to read
only their own records (and active cosmetics). It intentionally provides no
client write policies for reward-bearing data. Perform writes through the
trusted backend and keep `SUPABASE_SERVICE_ROLE_KEY` out of the extension and
browser.

The next backend milestone is an atomic decision/reward operation that validates
the session owner, applies the daily cap and streak rules, writes the decision,
and updates profile XP and balance in one transaction.

## Reward-rule baseline from the design document

- Buy: 20 acorns; reset the non-buy streak.
- Save: 30 acorns; an item bought after at least 48 hours earns an additional
  20 acorns.
- Skip: `min(150, 40 + floor(cart_total / 2))` acorns, pending for seven days.
- Three consecutive non-buy decisions: +25 acorns.
- Daily reward cap: 300 acorns.
- Tier thresholds use lifetime XP: Scout 250, Forager 1,000, Hoarder 3,000,
  Golden 7,500.

Resolve pending skips by matching stable `saved_items.item_key` values against
subsequent purchases. The API should validate incoming carts and ensure the
session and user IDs match; database constraints alone do not establish that
relationship.
