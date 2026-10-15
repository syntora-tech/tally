-- The last act of a payout may run on past its month (A-098), so an act's month is its payout's
-- month; an act made before the close keeps the month its period starts in.
create or replace function public.act_month(p_act public.supplier_act)
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select pr.month from public.payroll_item i join public.period pr on pr.id = i.period_id
      where i.id = p_act.payroll_item_id),
    date_trunc('month', p_act.period_from)::date);
$$;

grant execute on function public.act_month(public.supplier_act) to authenticated, service_role;

create or replace function public.guard_month_acts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> 'monthly' or new.status = 'void' or new.is_legacy or new.period_from is null then
    return new;
  end if;
  if new.payroll_item_id is null and exists (
       select 1 from public.supplier_act a
        where a.id <> new.id and a.payee_id = new.payee_id and a.type = 'monthly'
          and a.status <> 'void' and not a.is_legacy and a.payroll_item_id is null
          and daterange(a.period_from, a.period_to, '[]') && daterange(new.period_from, new.period_to, '[]')) then
    raise exception 'act_period_overlap' using errcode = 'TL066';
  end if;
  if new.assignment_ids is not null and exists (
       select 1 from public.supplier_act a
        where a.id <> new.id and a.payee_id = new.payee_id and a.type = 'monthly'
          and a.status <> 'void' and not a.is_legacy
          and public.act_month(a) = public.act_month(new)
          and a.assignment_ids && new.assignment_ids) then
    raise exception 'act_assignment_twice' using errcode = 'TL066';
  end if;
  return new;
end;
$$;
