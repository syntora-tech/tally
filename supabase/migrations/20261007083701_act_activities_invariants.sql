-- Parts already split off by a payment (A-083) keep their rate.
update public.supplier_act set rate_locked = true where amount_usd is not null;

-- I6 still holds for the money of an adjustment; only the act it goes into may change (A-085).
create or replace function public.guard_adjustment_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.period_id, new.person_id, new.payout_method, new.kind, new.amount, new.currency, new.reason)
         is not distinct from
         (old.period_id, old.person_id, old.payout_method, old.kind, old.amount, old.currency, old.reason) then
    return new;
  end if;
  if exists (select 1 from public.period p
              where p.id in (new.period_id, old.period_id) and p.status = 'closed') then
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;

-- An activity or adjustment goes only into an act of its own payout, and never in or out of an
-- issued act (A-085). SQLSTATE TL065 is mapped by the service layer.
create or replace function public.guard_act_activity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_item uuid;
begin
  if new.supplier_act_id is not distinct from old.supplier_act_id then
    return new;
  end if;
  if tg_table_name = 'payroll_line' then
    v_item := new.payroll_item_id;
  else
    select i.id into v_item from public.payroll_item i
     where i.period_id = new.period_id and i.person_id = new.person_id
       and i.payout_method = new.payout_method and i.kind = 'person';
  end if;
  if new.supplier_act_id is not null and not exists (
       select 1 from public.supplier_act a
        where a.id = new.supplier_act_id and a.payroll_item_id = v_item and a.status = 'draft') then
    raise exception 'act_activity_mismatch' using errcode = 'TL065';
  end if;
  if old.supplier_act_id is not null and exists (
       select 1 from public.supplier_act a where a.id = old.supplier_act_id and a.status <> 'draft') then
    raise exception 'act_activity_mismatch' using errcode = 'TL065', detail = 'issued act';
  end if;
  return new;
end;
$$;

create trigger guard_act_activity
  before update of supplier_act_id on public.payroll_line
  for each row execute function public.guard_act_activity();

create trigger guard_act_activity
  before update of supplier_act_id on public.adjustment
  for each row execute function public.guard_act_activity();
