-- Same guard as before; the owner may add an adjustment to a closed month with a reason (A-099),
-- e.g. a correction of an unpaid payout whose act is not issued yet. Changes and removals of the
-- month's adjustments stay frozen.
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
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;
