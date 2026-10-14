-- Same guard as before; the owner may remove a line from a payout of a closed month with a reason
-- (A-097), e.g. a director's salary that is paid through planned payments instead of the FOP act.
create or replace function public.guard_payroll_line_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' or new.amount is distinct from old.amount
      or new.currency is distinct from old.currency)
     and exists (select 1 from public.payroll_item i join public.period p on p.id = i.period_id
                  where i.id = old.payroll_item_id and p.status = 'closed') then
    if tg_op = 'DELETE'
       and coalesce(public.current_app_role(), '') = 'owner'
       and coalesce(trim(current_setting('app.reason', true)), '') <> '' then
      return old;
    end if;
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;
