create extension if not exists btree_gist with schema extensions;

-- A month paid in parts has an act per part (A-083): the act periods of one payout never overlap.
alter table public.supplier_act
  add constraint supplier_act_part_period_excl
  exclude using gist (
    payroll_item_id with =,
    daterange(period_from, period_to, '[]') with &&
  )
  where (type = 'monthly' and status <> 'void' and payroll_item_id is not null);

-- Same guard as before; the USD share of an issued act is frozen too (A-083).
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
        new.fx_rate, new.fx_source, new.amount_usd)
       is distinct from
       (old.contract_id, old.payee_id, old.number, old.act_date,
        old.period_from, old.period_to, old.amount_uah, old.snapshot, old.date_override_reason, old.is_legacy,
        old.fx_rate, old.fx_source, old.amount_usd)
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
