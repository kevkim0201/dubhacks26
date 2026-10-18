# Supabase database

`schema.sql` creates the initial backend tables and policies for Squirrel Savings.
Run it in the Supabase SQL Editor for a new project.

## What the tables hold

- `profiles`: one row per Supabase Auth user. `total_xp` is lifetime progression
  and determines the generated `tier`; `acorn_balance` is spendable and may go
  down when users buy cosmetics.
- `checkout_sessions`: cart snapshot (store, items, total, page URL) plus the
  conversation: transcript, duration, Pip's assessment, suggestion, reason and
  closing line. The transcript is what the shopper said out loud, so treat it as
  personal data. Users can read their own rows only (RLS).
- `decisions`: one completed action per checkout session, with the stored AI
  recommendation and the acorn/XP payout breakdown.
- `saved_items`: saved product details for future wishlist features. Saving an
  item does not trigger a delayed reward in the current MVP.
- `cosmetics` and `user_cosmetics`: shop catalog and user unlocks.

## Security and application writes

The schema enables row-level security and allows authenticated users to read
only their own records (and active cosmetics). It intentionally provides no
client write policies for reward-bearing data. Perform writes through the
trusted backend and keep `SUPABASE_SERVICE_ROLE_KEY` out of the extension and
browser.

The database function `record_checkout_decision` validates the session owner,
prevents repeat awards, applies the daily cap, writes the decision, and updates
profile XP and acorn balance in one transaction. Only the backend `service_role`
can execute it.

## MVP recommendation-based reward matrix

- Buy + AI recommends Buy: 15 acorns and 15 XP.
- Buy + AI recommends Save or Don't Buy: 0 acorns and 0 XP.
- Save for Later: 10 acorns and 10 XP, regardless of the AI recommendation.
- Don't Buy + AI recommends Don't Buy: 30 acorns and 30 XP.
- Don't Buy + AI recommends Buy or Save: 5 engagement acorns and 5 XP.
- No streak bonus, escrow, or delayed purchase bonus.
- The UTC calendar-day cap is 200 acorns. XP stops when the cap stops acorns;
  if fewer acorns remain than a payout, both acorns and XP are limited to the
  remaining amount.
- Spending acorns does not reduce lifetime XP. XP drives tiers at Scout 250,
  Forager 1,000, Hoarder 3,000, and Golden 7,500.

The extension starts a checkout through `POST /api/checkout/start`, and submits
the user's button action to `POST /api/checkout/{session_id}/decision`.
The trusted voice/AI service stores the assessment and recommendation through
the internal `POST /api/checkout/{session_id}/assessment` endpoint using
`INTERNAL_SERVICE_TOKEN`; do not expose this token to the extension. `wait` from
the AI is stored as the `save` action. The reward function uses this stored
recommendation, never a recommendation included in the user's decision request.
`GET /api/user/state` returns the authenticated user's profile and latest
decisions.

For persistent avatar cosmetics, apply
`migrations/20261018_avatar_cosmetics.sql` after the recommendation rewards
migration. It seeds the shop, grants the Meadow and Acorn starter items, awards
the Backpack/Bandana/Satchel/Crown gifts on tier-up, and adds service-role-only
RPCs for atomic purchases and equipment changes. The extension reads the
authenticated user's `/api/cosmetics` state and uses it to render Pip in the
closet, popup, dashboard, and checkout overlay.

To add the floating pet shop category, apply
`migrations/20261018_pet_cosmetics.sql` after the avatar cosmetics migration.
Pet purchases and equipment use the same authenticated cosmetics API and are
saved in the `pet` equipment slot.

To let users remove the equipped item in any slot without losing ownership,
apply `migrations/20261018_cosmetic_unequip.sql` and restart the backend. The
Avatar closet then offers a **Remove from Pip** action for equipped items.

## Existing Supabase project

Run `migrations/20261018_conversation_logging.sql` to add the conversation log
columns (`page_url`, `transcript`, `duration_seconds`, `conversation_ended_at`)
to `checkout_sessions`, then `migrations/20261018_purchase_category.sql` to add
`category` and `item_name` to `checkout_sessions` and `decisions`. Both are safe
to run more than once. Then run `migrations/20261018_category_values.sql`, which
limits `category` to the fixed list Pip classifies into (see `CATEGORIES` in
`backend/app/routers/checkout.py`).

If you already ran the previous version of `schema.sql`, run
`migrations/20261017_recommendation_rewards.sql` in the Supabase SQL Editor
instead of rerunning the schema. The migration stops if pending or cancelled
decisions exist, so they can be reviewed rather than silently discarded. It
preserves their original reward breakdown in `legacy_reward_breakdown` and
backfills each historical decision's XP award from its previously awarded
acorns; it does not alter existing profile balances or lifetime XP totals.
