-- Owner decision (A-044), amending I1: an issued invoice that has received no payment may be
-- revised in place. The number never changes; every revision needs a reason (app.reason), bumps
-- `revision`, and the previous state is stored in invoice_revision. Any payment freezes it.

grant select on public.invoice_revision to authenticated;
grant all on public.invoice_revision to service_role;
revoke all on public.invoice_revision from anon;

create or replace function public.guard_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
  v_content_changed boolean;
  v_reason text := nullif(trim(current_setting('app.reason', true)), '');
  v_revising boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'issued invoices cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if new.number is distinct from old.number then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'the number never changes';
    end if;

    v_content_changed := (new.client_id, new.contract_id, new.period_id, new.issue_date, new.due_date,
                          new.currency, new.total, new.snapshot, new.date_override_reason, new.is_legacy)
                         is distinct from
                         (old.client_id, old.contract_id, old.period_id, old.issue_date, old.due_date,
                          old.currency, old.total, old.snapshot, old.date_override_reason, old.is_legacy);

    if v_content_changed or new.revision <> old.revision then
      if not (old.status = 'issued' and new.status = 'issued' and old.paid_amount = 0 and new.paid_amount = 0) then
        raise exception 'issued_invoice_immutable' using errcode = 'TL001',
          detail = 'only issued invoices without payments can be revised';
      end if;
      if (new.client_id, new.contract_id, new.period_id, new.currency, new.is_legacy)
         is distinct from (old.client_id, old.contract_id, old.period_id, old.currency, old.is_legacy) then
        raise exception 'issued_invoice_immutable' using errcode = 'TL001',
          detail = 'client, contract, period and currency cannot change; void and reissue instead';
      end if;
      if new.revision <> old.revision + 1 then
        raise exception 'invoice_revision_sequence' using errcode = 'TL005';
      end if;
      if v_reason is null then
        raise exception 'invoice_revision_reason_required' using errcode = 'TL006';
      end if;
      if not public.is_working_day(new.issue_date)
         and (coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner') then
        raise exception 'document_date_not_working_day' using errcode = 'TL004', detail = to_char(new.issue_date, 'DD.MM.YYYY');
      end if;
      insert into public.invoice_revision (invoice_id, revision, issue_date, due_date, total, snapshot, pdf_file_id, reason)
      values (old.id, old.revision, old.issue_date, old.due_date, old.total, old.snapshot, old.pdf_file_id, v_reason);
      v_revising := true;
    end if;

    -- Generated files are set once per revision; a revision may clear them for re-rendering.
    if not v_revising
       and ((old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
            or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id)) then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;

    v_allowed := case old.status
      when 'issued' then array['issued', 'partially_paid', 'paid', 'void', 'written_off']
      when 'partially_paid' then array['partially_paid', 'paid', 'void', 'written_off']
      when 'paid' then array['paid']
      else array[old.status::text]
    end;
    if not new.status::text = any (v_allowed) then
      raise exception 'invoice_status_backwards' using errcode = 'TL002', detail = format('%s → %s', old.status, new.status);
    end if;
  end if;

  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    if new.snapshot is null and not new.is_legacy then
      raise exception 'invoice_snapshot_required' using errcode = 'TL003';
    end if;
    if not new.is_legacy and not public.is_working_day(new.issue_date) then
      if coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner' then
        raise exception 'document_date_not_working_day' using errcode = 'TL004',
          detail = to_char(new.issue_date, 'DD.MM.YYYY');
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Lines: editable in drafts and during a revision of an unpaid issued invoice (reason set);
-- lines of a void invoice may only release their timesheet so a reissued copy can take it.
create or replace function public.guard_invoice_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoice;
begin
  select * into v_invoice from public.invoice i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_invoice.id is null or v_invoice.status = 'draft' then
    return coalesce(new, old);
  end if;
  if v_invoice.status = 'issued' and v_invoice.paid_amount = 0
     and nullif(trim(current_setting('app.reason', true)), '') is not null then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and v_invoice.status = 'void' and new.timesheet_id is null
     and (new.invoice_id, new.position, new.description_en, new.description_ua, new.quantity, new.unit_price, new.amount)
         is not distinct from
         (old.invoice_id, old.position, old.description_en, old.description_ua, old.quantity, old.unit_price, old.amount) then
    return new;
  end if;
  raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'lines of an issued invoice are frozen';
end;
$$;
