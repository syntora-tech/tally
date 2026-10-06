-- Existing lines were all accrued in USD (A-075).
update public.payroll_line set amount = amount_usd where amount is null;

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
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;
