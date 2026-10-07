-- Same guard as before; the work chosen for an issued act is frozen too (A-089).
create or replace function public.guard_supplier_act()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract public.contract;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'issued acts cannot be deleted';
    end if;
    return old;
  end if;

  select * into v_contract from public.contract c where c.id = new.contract_id;
  if v_contract.kind <> 'fop' or v_contract.payee_id is distinct from new.payee_id then
    raise exception 'act_contract_mismatch' using errcode = 'TL060';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    -- A legacy act's type was guessed by the import (A-052); the trips import may correct it.
    if (new.contract_id, new.payee_id, new.number, new.act_date,
        new.period_from, new.period_to, new.amount_uah, new.snapshot, new.date_override_reason, new.is_legacy,
        new.fx_rate, new.fx_source, new.amount_usd, new.assignment_ids)
       is distinct from
       (old.contract_id, old.payee_id, old.number, old.act_date,
        old.period_from, old.period_to, old.amount_uah, old.snapshot, old.date_override_reason, old.is_legacy,
        old.fx_rate, old.fx_source, old.amount_usd, old.assignment_ids)
       or (new.type is distinct from old.type and not old.is_legacy) then
      raise exception 'issued_act_immutable' using errcode = 'TL001';
    end if;
    if old.payroll_item_id is not null and new.payroll_item_id is distinct from old.payroll_item_id then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'the payout is set once';
    end if;
    -- The reimbursement an issued act pays (A-070) is set once.
    if old.reimbursement_id is not null and new.reimbursement_id is distinct from old.reimbursement_id then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'the reimbursement is set once';
    end if;
    if (old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
       or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id) then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;
    if not (new.status = old.status or (old.status = 'issued' and new.status = 'void')) then
      raise exception 'act_status_backwards' using errcode = 'TL002', detail = format('%s → %s', old.status, new.status);
    end if;
  end if;

  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') and not new.is_legacy then
    if new.snapshot is null then
      raise exception 'act_snapshot_required' using errcode = 'TL003';
    end if;
    if not public.is_working_day(new.act_date)
       and (coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner') then
      raise exception 'document_date_not_working_day' using errcode = 'TL004',
        detail = to_char(new.act_date, 'DD.MM.YYYY');
    end if;
  end if;
  return new;
end;
$$;

-- An adjustment goes into an act of its own payout; before the close, into a draft act of the
-- person's FOP for that month (A-089). Never in or out of an issued act (A-085).
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
  if new.supplier_act_id is not null and v_item is not null and not exists (
       select 1 from public.supplier_act a
        where a.id = new.supplier_act_id and a.payroll_item_id = v_item and a.status = 'draft') then
    raise exception 'act_activity_mismatch' using errcode = 'TL065';
  end if;
  -- Nested: payroll_line has no person_id, and PL/pgSQL plans a whole condition at once.
  if new.supplier_act_id is not null and v_item is null then
    if tg_table_name <> 'adjustment' or not exists (
         select 1 from public.supplier_act a
           join public.person p on p.id = new.person_id
           join public.period pr on pr.id = new.period_id
          where a.id = new.supplier_act_id and a.payroll_item_id is null and a.status = 'draft'
            and a.payee_id = p.default_payee_id and new.payout_method = 'fiat'
            and date_trunc('month', a.period_from) = pr.month) then
      raise exception 'act_activity_mismatch' using errcode = 'TL065';
    end if;
  end if;
  if old.supplier_act_id is not null and exists (
       select 1 from public.supplier_act a where a.id = old.supplier_act_id and a.status <> 'draft') then
    raise exception 'act_activity_mismatch' using errcode = 'TL065', detail = 'issued act';
  end if;
  return new;
end;
$$;

-- Acts of a month made before the close (A-089): their periods never overlap, as for the acts of
-- a payout (supplier_act_part_period_excl), and a piece of work goes into one act of the month.
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
          and date_trunc('month', a.period_from) = date_trunc('month', new.period_from)
          and a.assignment_ids && new.assignment_ids) then
    raise exception 'act_assignment_twice' using errcode = 'TL066';
  end if;
  return new;
end;
$$;

create trigger guard_month_acts
  before insert or update of period_from, period_to, status, assignment_ids, payroll_item_id
  on public.supplier_act
  for each row execute function public.guard_month_acts();
