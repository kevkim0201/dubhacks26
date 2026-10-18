-- Let users clear the equipped cosmetic in a slot without losing ownership.
create or replace function public.unequip_cosmetic(p_user_id uuid, p_slot text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared integer;
begin
  if p_slot not in ('background', 'head', 'neck', 'held', 'effect', 'pet') then
    raise exception 'Invalid cosmetic slot' using errcode = '22023';
  end if;

  update public.user_cosmetics
  set is_equipped = false
  where user_id = p_user_id
    and slot = p_slot
    and is_equipped;

  get diagnostics v_cleared = row_count;

  return jsonb_build_object(
    'unequipped', v_cleared > 0,
    'slot', p_slot
  );
end;
$$;

grant execute on function public.unequip_cosmetic(uuid, text) to service_role;
revoke all on function public.unequip_cosmetic(uuid, text) from public, anon, authenticated;

notify pgrst, 'reload schema';
