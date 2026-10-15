-- Same guard as before (A-099); an adjustment of a closed month may still move between the draft
-- acts of its payout (A-085) — which act it goes into is not money, and guard_act_activity checks
-- the act. Its amount, currency and the rest stay frozen.
create or replace function public.guard_adjustment_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.period p
              where p.id in (new.period_id, old.period_id) and p.status = 'closed') then
    if tg_op = 'INSERT'
       and coalesce(public.current_app_role(), '') = 'owner'
       and coalesce(trim(current_setting('app.reason', true)), '') <> '' then
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
