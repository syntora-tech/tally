-- A-124: the owner may also change an adjustment of a closed month with a reason (the service only
-- allows it while its payout is unpaid and its act not issued); it never moves to another payout.
create or replace function public.guard_adjustment_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.period p
              where p.id in (new.period_id, old.period_id) and p.status = 'closed') then
    if tg_op in ('INSERT', 'UPDATE')
       and coalesce(public.current_app_role(), '') = 'owner'
       and coalesce(trim(current_setting('app.reason', true)), '') <> ''
       and (tg_op = 'INSERT' or (new.period_id, new.person_id, new.payout_method, new.legacy_ref)
            is not distinct from (old.period_id, old.person_id, old.payout_method, old.legacy_ref)) then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and (to_jsonb(new) - 'supplier_act_id'::text - 'updated_at'::text)
           = (to_jsonb(old) - 'supplier_act_id'::text - 'updated_at'::text) then
      return new;
    end if;
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;
