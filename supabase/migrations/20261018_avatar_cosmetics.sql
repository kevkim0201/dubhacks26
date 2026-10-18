-- Persistent cosmetic catalog, purchases, equipment, and tier-up gifts.
alter table public.cosmetics
  add column if not exists is_tier_gift boolean not null default false;

alter table public.user_cosmetics
  add column if not exists slot text;

update public.user_cosmetics uc
set slot = c.category
from public.cosmetics c
where c.id = uc.cosmetic_id
  and uc.slot is null;

with equipped_duplicates as (
  select uc.user_id, uc.cosmetic_id,
    row_number() over (
      partition by uc.user_id, c.category
      order by uc.unlocked_at, uc.cosmetic_id
    ) as position
  from public.user_cosmetics uc
  join public.cosmetics c on c.id = uc.cosmetic_id
  where uc.is_equipped
)
update public.user_cosmetics uc
set is_equipped = false
from equipped_duplicates d
where d.user_id = uc.user_id
  and d.cosmetic_id = uc.cosmetic_id
  and d.position > 1;

create unique index if not exists user_cosmetics_one_equipped_per_slot_idx
  on public.user_cosmetics (user_id, slot)
  where is_equipped and slot is not null;

insert into public.cosmetics
  (id, name, description, category, cost_acorns, minimum_tier, asset_key, is_tier_gift)
values
  ('meadow', 'Meadow', 'Pip’s sunny meadow home.', 'background', 0, 'Baby', 'meadow', false),
  ('forest', 'Forest', 'A quiet forest clearing.', 'background', 200, 'Scout', 'forest', false),
  ('cozy-room', 'Cozy Room', 'A warm little nook.', 'background', 250, 'Scout', 'room', false),
  ('beach', 'Beach', 'A breezy day by the sea.', 'background', 450, 'Forager', 'beach', false),
  ('mountains', 'Mountains', 'A high-up hideaway.', 'background', 600, 'Forager', 'mountains', false),
  ('city', 'City', 'A sparkling city at dusk.', 'background', 1200, 'Hoarder', 'city', false),
  ('campus', 'Campus', 'A special Golden-tier campus scene.', 'background', 2500, 'Golden', 'campus', false),

  ('beanie', 'Beanie', 'A cozy knitted hat.', 'head', 25, 'Baby', 'beanie', false),
  ('leaf-hat', 'Leaf', 'A tiny forest leaf.', 'head', 25, 'Baby', 'leaf', false),
  ('cap', 'Cap', 'A classic Nook cap.', 'head', 30, 'Baby', 'cap', false),
  ('flower', 'Flower', 'A cheerful flower accessory.', 'head', 30, 'Baby', 'flower', false),
  ('bucket-hat', 'Bucket Hat', 'A sunny-day favorite.', 'head', 50, 'Baby', 'bucket', false),
  ('sun-hat', 'Sun Hat', 'A hat for bright adventures.', 'head', 80, 'Scout', 'sunhat', false),
  ('chef-hat', 'Chef Hat', 'Ready to make a little snack.', 'head', 90, 'Scout', 'chef', false),
  ('party-hat', 'Party Hat', 'A little celebration for Pip.', 'head', 90, 'Scout', 'party', false),
  ('glasses', 'Glasses', 'A thoughtful squirrel look.', 'head', 100, 'Scout', 'glasses', false),
  ('headphones', 'Headphones', 'Pip’s favorite listening gear.', 'head', 120, 'Scout', 'headphones', false),
  ('animal-hood', 'Animal Hood', 'A soft woodland hood.', 'head', 200, 'Forager', 'hood', false),
  ('sunglasses', 'Sunglasses', 'Cool shade for sunny days.', 'head', 220, 'Forager', 'sunglasses', false),
  ('goggles', 'Goggles', 'For curious explorers.', 'head', 280, 'Forager', 'goggles', false),
  ('wizard-hat', 'Wizard Hat', 'A little extra wonder.', 'head', 350, 'Forager', 'wizard', false),
  ('devil-horns', 'Devil Horns', 'A playful Hoarder-tier look.', 'head', 650, 'Hoarder', 'horns', false),
  ('halo', 'Halo', 'A glowing golden-hour look.', 'head', 750, 'Hoarder', 'halo', false),
  ('crown', 'Crown', 'The Golden-tier gift for Pip.', 'head', 0, 'Golden', 'crown', true),

  ('scarf', 'Scarf', 'A bright red scarf.', 'neck', 40, 'Baby', 'scarf', false),
  ('backpack', 'Backpack', 'The Scout tier-up gift.', 'neck', 0, 'Scout', 'backpack', true),
  ('bow-tie', 'Bow Tie', 'A neat little bow tie.', 'neck', 90, 'Scout', 'bowtie', false),
  ('bell-collar', 'Bell Collar', 'A collar with a golden bell.', 'neck', 100, 'Scout', 'collar', false),
  ('bandana', 'Bandana', 'The Forager tier-up gift.', 'neck', 0, 'Forager', 'bandana', true),
  ('neck-headphones', 'Headphones (neck)', 'Comfy headphones to wear around the neck.', 'neck', 250, 'Forager', 'neckphones', false),
  ('camera-neck', 'Camera', 'A little camera for adventures.', 'neck', 300, 'Forager', 'camera', false),
  ('satchel', 'Satchel', 'The Hoarder tier-up gift.', 'neck', 0, 'Hoarder', 'satchel', true),
  ('sweater', 'Sweater', 'A warm Nook sweater.', 'neck', 650, 'Hoarder', 'sweater', false),

  ('acorn', 'Acorn', 'Pip’s classic held acorn.', 'held', 0, 'Baby', 'acorn', false),
  ('coffee', 'Coffee', 'A little cup for a thoughtful pause.', 'held', 15, 'Baby', 'coffee', false),
  ('book', 'Book', 'A good read for a quiet moment.', 'held', 20, 'Baby', 'book', false),
  ('phone', 'Phone', 'Keep in touch on the go.', 'held', 75, 'Scout', 'phone', false),
  ('baseball', 'Baseball', 'Ready for a game in the park.', 'held', 75, 'Scout', 'baseball', false),
  ('bubble-tea', 'Bubble Tea', 'A sweet little treat.', 'held', 85, 'Scout', 'boba', false),
  ('fish', 'Fish', 'A friendly fish companion.', 'held', 85, 'Scout', 'fish', false),
  ('laptop', 'Laptop', 'For Pip’s next big idea.', 'held', 110, 'Scout', 'laptop', false),
  ('plant', 'Plant', 'A leafy friend to care for.', 'held', 200, 'Forager', 'plant', false),
  ('map', 'Map', 'Find a new path to explore.', 'held', 220, 'Forager', 'map', false),
  ('camera', 'Camera', 'Capture a little memory.', 'held', 280, 'Forager', 'photocam', false),
  ('gift', 'Gift', 'A present to brighten the day.', 'held', 600, 'Hoarder', 'gift', false),
  ('heart', 'Heart', 'A little reminder to be kind.', 'held', 600, 'Hoarder', 'heart', false),
  ('sparkles', 'Sparkles', 'A tiny bit of extra magic.', 'held', 750, 'Hoarder', 'sparkles', false),

  ('zzz', 'Zzz', 'A sleepy little effect.', 'effect', 75, 'Scout', 'sleep', false),
  ('exclamation', '!', 'A bright exclamation effect.', 'effect', 75, 'Scout', 'exclaim', false),
  ('question', '?', 'A curious question effect.', 'effect', 75, 'Scout', 'question', false),
  ('music-notes', 'Music Notes', 'A little tune for Pip.', 'effect', 100, 'Scout', 'music', false),
  ('leaves', 'Leaves', 'A swirl of forest leaves.', 'effect', 200, 'Forager', 'leaves', false),
  ('hearts', 'Hearts', 'A few floating hearts.', 'effect', 250, 'Forager', 'hearts', false),
  ('stars', 'Stars', 'A little starry sparkle.', 'effect', 300, 'Forager', 'stars', false),
  ('snowflakes', 'Snowflakes', 'A gentle flurry of snow.', 'effect', 600, 'Hoarder', 'snow', false),
  ('fireflies', 'Fireflies', 'A warm evening glow.', 'effect', 750, 'Hoarder', 'fireflies', false),
  ('cherry-blossoms', 'Cherry Blossoms', 'Petals floating through the air.', 'effect', 900, 'Hoarder', 'blossoms', false)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  cost_acorns = excluded.cost_acorns,
  minimum_tier = excluded.minimum_tier,
  asset_key = excluded.asset_key,
  is_tier_gift = excluded.is_tier_gift,
  is_active = true;

create or replace function public.grant_base_cosmetics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_cosmetics (user_id, cosmetic_id, slot, is_equipped)
  select new.id, c.id, c.category, true
  from public.cosmetics c
  where c.id in ('meadow', 'acorn')
  on conflict (user_id, cosmetic_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_grant_base_cosmetics on public.profiles;
create trigger profiles_grant_base_cosmetics
after insert on public.profiles
for each row execute function public.grant_base_cosmetics();

insert into public.user_cosmetics (user_id, cosmetic_id, slot, is_equipped)
select p.id, c.id, c.category,
  not exists (
    select 1 from public.user_cosmetics equipped
    where equipped.user_id = p.id
      and equipped.slot = c.category
      and equipped.is_equipped
  )
from public.profiles p
cross join public.cosmetics c
where c.id in ('meadow', 'acorn')
on conflict (user_id, cosmetic_id) do nothing;

update public.user_cosmetics uc
set is_equipped = true
from public.cosmetics c
where c.id = uc.cosmetic_id
  and uc.user_id in (select id from public.profiles)
  and c.id in ('meadow', 'acorn')
  and not exists (
    select 1 from public.user_cosmetics equipped
    where equipped.user_id = uc.user_id
      and equipped.slot = c.category
      and equipped.is_equipped
  );

create or replace function public.grant_tier_cosmetic_gifts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tier is distinct from old.tier then
    insert into public.user_cosmetics (user_id, cosmetic_id, slot)
    select new.id, c.id, c.category
    from public.cosmetics c
    where (case c.minimum_tier
        when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
        when 'Hoarder' then 3 when 'Golden' then 4 else 99 end)
      <= (case new.tier
        when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
        when 'Hoarder' then 3 when 'Golden' then 4 else -1 end)
      and (case c.minimum_tier
        when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
        when 'Hoarder' then 3 when 'Golden' then 4 else 99 end)
      > (case old.tier
        when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
        when 'Hoarder' then 3 when 'Golden' then 4 else -1 end)
      and c.is_tier_gift
    on conflict (user_id, cosmetic_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_grant_tier_cosmetic_gifts on public.profiles;
create trigger profiles_grant_tier_cosmetic_gifts
after update of total_xp on public.profiles
for each row execute function public.grant_tier_cosmetic_gifts();

insert into public.user_cosmetics (user_id, cosmetic_id, slot)
select p.id, c.id, c.category
from public.profiles p
join public.cosmetics c
  on (case c.minimum_tier
      when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
      when 'Hoarder' then 3 when 'Golden' then 4 else 99 end)
    <= (case p.tier
      when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
      when 'Hoarder' then 3 when 'Golden' then 4 else -1 end)
 and c.is_tier_gift
on conflict (user_id, cosmetic_id) do nothing;

create or replace function public.purchase_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cosmetic public.cosmetics%rowtype;
  v_profile public.profiles%rowtype;
begin
  select * into v_cosmetic
  from public.cosmetics
  where id = p_cosmetic_id and is_active
  for share;

  if not found then
    raise exception 'Cosmetic not found' using errcode = 'P0002';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User profile not found' using errcode = 'P0002';
  end if;

  if (case v_profile.tier
      when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
      when 'Hoarder' then 3 when 'Golden' then 4 else -1 end)
     < (case v_cosmetic.minimum_tier
      when 'Baby' then 0 when 'Scout' then 1 when 'Forager' then 2
      when 'Hoarder' then 3 when 'Golden' then 4 else 99 end) then
    raise exception 'Reach the % tier to unlock this cosmetic', v_cosmetic.minimum_tier
      using errcode = '42501';
  end if;

  if v_cosmetic.is_tier_gift then
    raise exception 'Tier-up gifts are granted automatically' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.user_cosmetics
    where user_id = p_user_id and cosmetic_id = p_cosmetic_id
  ) then
    return jsonb_build_object('purchased', false, 'acorn_balance', v_profile.acorn_balance);
  end if;

  update public.profiles
  set acorn_balance = acorn_balance - v_cosmetic.cost_acorns
  where id = p_user_id
    and acorn_balance >= v_cosmetic.cost_acorns
  returning * into v_profile;

  if not found then
    raise exception 'Not enough acorns' using errcode = '22023';
  end if;

  insert into public.user_cosmetics (user_id, cosmetic_id, slot)
  values (p_user_id, p_cosmetic_id, v_cosmetic.category)
  on conflict (user_id, cosmetic_id) do nothing;

  return jsonb_build_object(
    'purchased', true,
    'acorn_balance', v_profile.acorn_balance,
    'cosmetic_id', p_cosmetic_id
  );
end;
$$;

create or replace function public.equip_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cosmetic public.cosmetics%rowtype;
begin
  select c.* into v_cosmetic
  from public.cosmetics c
  join public.user_cosmetics uc on uc.cosmetic_id = c.id
  where uc.user_id = p_user_id
    and c.id = p_cosmetic_id
    and c.is_active;

  if not found then
    raise exception 'Cosmetic is not owned by this user' using errcode = '42501';
  end if;

  update public.user_cosmetics
  set is_equipped = false
  where user_id = p_user_id
    and slot = v_cosmetic.category
    and is_equipped
    and cosmetic_id <> p_cosmetic_id;

  update public.user_cosmetics
  set is_equipped = true, slot = v_cosmetic.category
  where user_id = p_user_id and cosmetic_id = p_cosmetic_id;

  return jsonb_build_object(
    'equipped', true,
    'cosmetic_id', p_cosmetic_id,
    'category', v_cosmetic.category,
    'asset_key', v_cosmetic.asset_key
  );
end;
$$;

grant execute on function public.purchase_cosmetic(uuid, text) to service_role;
grant execute on function public.equip_cosmetic(uuid, text) to service_role;
revoke all on function public.purchase_cosmetic(uuid, text) from public, anon, authenticated;
revoke all on function public.equip_cosmetic(uuid, text) from public, anon, authenticated;
revoke all on function public.grant_base_cosmetics() from public, anon, authenticated;
revoke all on function public.grant_tier_cosmetic_gifts() from public, anon, authenticated;
