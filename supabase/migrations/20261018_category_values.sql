-- Restrict category to the fixed list Pip classifies into (CATEGORIES in
-- backend/app/routers/checkout.py; change both together).
-- Apply after 20261018_purchase_category.sql. Safe to re-run.

do $$
declare
  allowed text[] := array[
    'electronics', 'clothing', 'shoes', 'beauty', 'home', 'kitchen', 'food',
    'health', 'sports', 'outdoors', 'toys', 'books', 'entertainment', 'travel',
    'office', 'pets', 'jewelry', 'automotive', 'other'
  ];
begin
  -- Anything outside the list (older or hand-entered values) becomes 'other'.
  update public.checkout_sessions set category = 'other'
    where category is not null and not (category = any (allowed));
  update public.decisions set category = 'other'
    where category is not null and not (category = any (allowed));
end $$;

alter table public.checkout_sessions drop constraint if exists checkout_sessions_category_check;
alter table public.checkout_sessions add constraint checkout_sessions_category_check check (
  category in ('electronics', 'clothing', 'shoes', 'beauty', 'home', 'kitchen', 'food',
    'health', 'sports', 'outdoors', 'toys', 'books', 'entertainment', 'travel',
    'office', 'pets', 'jewelry', 'automotive', 'other')
);

alter table public.decisions drop constraint if exists decisions_category_check;
alter table public.decisions add constraint decisions_category_check check (
  category in ('electronics', 'clothing', 'shoes', 'beauty', 'home', 'kitchen', 'food',
    'health', 'sports', 'outdoors', 'toys', 'books', 'entertainment', 'travel',
    'office', 'pets', 'jewelry', 'automotive', 'other')
);

notify pgrst, 'reload schema';
