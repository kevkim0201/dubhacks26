-- Add floating companion pets to the cosmetic catalog.
insert into public.cosmetics
  (id, name, description, category, cost_acorns, minimum_tier, asset_key, is_tier_gift)
values
  ('pet-bunny', 'Bunny', 'A curious little bunny that floats beside Pip.', 'pet', 35, 'Baby', 'bunny', false),
  ('pet-chick', 'Chick', 'A sunny chick who loves tagging along.', 'pet', 50, 'Baby', 'chick', false),
  ('pet-turtle', 'Turtle', 'A tiny turtle companion, always unhurried.', 'pet', 150, 'Scout', 'turtle', false),
  ('pet-fox', 'Fox', 'A clever fox friend from the forest.', 'pet', 300, 'Forager', 'fox', false),
  ('pet-otter', 'Otter', 'A playful otter who drifts along with Pip.', 'pet', 600, 'Hoarder', 'otter', false)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  cost_acorns = excluded.cost_acorns,
  minimum_tier = excluded.minimum_tier,
  asset_key = excluded.asset_key,
  is_tier_gift = excluded.is_tier_gift,
  is_active = true;
