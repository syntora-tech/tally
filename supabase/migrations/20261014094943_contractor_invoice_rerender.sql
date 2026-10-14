-- Same guard as A-090; an issued contractor invoice may be rendered again (A-093).
create or replace function public.guard_contractor_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract public.contract;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued_contractor_invoice_immutable' using errcode = 'TL001', detail = 'issued invoices cannot be deleted';
    end if;
    return old;
  end if;

  select * into v_contract from public.contract c where c.id = new.contract_id;
  if v_contract.kind <> 'fop' or v_contract.payee_id is distinct from new.payee_id then
    raise exception 'contractor_invoice_contract_mismatch' using errcode = 'TL067';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if (new.contract_id, new.payee_id, new.payroll_item_id, new.number, new.invoice_date, new.period_from,
        new.period_to, new.hours, new.amount, new.currency, new.description_en, new.description_ua, new.snapshot)
       is distinct from
       (old.contract_id, old.payee_id, old.payroll_item_id, old.number, old.invoice_date, old.period_from,
        old.period_to, old.hours, old.amount, old.currency, old.description_en, old.description_ua, old.snapshot) then
      raise exception 'issued_contractor_invoice_immutable' using errcode = 'TL001';
    end if;
    -- A re-render with a new template layout (A-093) clears both files with a reason; the job then
    -- files the new ones. Otherwise generated files are set once.
    if ((old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
        or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id))
       and not (new.gdoc_file_id is null and new.pdf_file_id is null
                and coalesce(trim(current_setting('app.reason', true)), '') <> '') then
      raise exception 'issued_contractor_invoice_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;
    if not (new.status = old.status or (old.status = 'issued' and new.status = 'void')) then
      raise exception 'contractor_invoice_status_backwards' using errcode = 'TL002', detail = format('%s → %s', old.status, new.status);
    end if;
  end if;

  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') and new.snapshot is null then
    raise exception 'contractor_invoice_snapshot_required' using errcode = 'TL003';
  end if;
  return new;
end;
$$;
