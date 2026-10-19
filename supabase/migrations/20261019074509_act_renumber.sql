-- Custom SQL migration file, put your code below! --
-- Same guard as before; a revision may also write the number in the sequence's current format
-- under the same counter, its last group of digits (A-119).
create or replace function public.guard_supplier_act()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract public.contract;
  v_revising boolean;
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

  -- An issued act not signed and not paid may get new dates and a new PDF under its number (A-112).
  v_revising := tg_op = 'UPDATE' and old.status = 'issued' and new.status = 'issued'
    and coalesce(current_setting('app.act_revision', true), '') = 'on'
    and old.signed_url is null and old.signed_document_id is null and not old.rate_locked
    and not old.is_legacy
    and coalesce(public.current_app_role(), '') in ('owner', 'finance');

  if tg_op = 'UPDATE' and old.status <> 'draft' and v_revising then
    if (new.contract_id, new.payee_id, new.amount_uah, new.is_legacy, new.type,
        new.fx_rate, new.fx_source, new.amount_usd, new.assignment_ids, new.payroll_item_id)
       is distinct from
       (old.contract_id, old.payee_id, old.amount_uah, old.is_legacy, old.type,
        old.fx_rate, old.fx_source, old.amount_usd, old.assignment_ids, old.payroll_item_id)
       or (new.number is distinct from old.number
           and (new.number is null
                or substring(new.number from '(\d+)\D*$') is distinct from substring(old.number from '(\d+)\D*$')))
       or new.snapshot is null
       or extract(year from new.act_date) <> extract(year from old.act_date) then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'a revision changes dates and the number format only';
    end if;
    if not public.is_working_day(new.act_date)
       and (coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner') then
      raise exception 'document_date_not_working_day' using errcode = 'TL004',
        detail = to_char(new.act_date, 'DD.MM.YYYY');
    end if;
  elsif tg_op = 'UPDATE' and old.status <> 'draft' then
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
    if (old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
       or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id) then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;
    -- The owner may take back a mistaken void (A-111): the act returns as it was, number included.
    if not (new.status = old.status
            or (old.status = 'issued' and new.status = 'void')
            or (old.status = 'void' and new.status = 'issued' and old.number is not null
                and coalesce(public.current_app_role(), '') = 'owner')) then
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
