-- Owner-authorized reconciliation with a signed original. File bytes and financial data stay immutable.
-- Drafts have NULL numbers, so a deferred unique constraint retains I2 while permitting atomic swaps.
drop index public.invoice_number_key;
alter table public.invoice add constraint invoice_number_key unique (number) deferrable initially immediate;

create table public.invoice_number_correction (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice(id),
  signed_document_id uuid not null references public.document(id),
  old_number text not null,
  new_number text not null,
  reason text not null check (length(trim(reason)) > 0),
  transaction_id text not null default pg_current_xact_id()::text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid()
);
alter table public.invoice_number_correction enable row level security;
create policy invoice_number_correction_select on public.invoice_number_correction
  for select to authenticated using (public.current_app_role() in ('owner','finance'));
select public.setup_app_table('public.invoice_number_correction');
revoke insert, update, delete on public.invoice_number_correction from authenticated;

create or replace function public.guard_invoice()
returns trigger
language plpgsql
security definer
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

  -- I7: paid_amount is always the sum of allocations; only refresh_invoice_payment() moves it.
  if tg_op = 'INSERT' or new.paid_amount is distinct from old.paid_amount then
    if new.paid_amount <> coalesce((select sum(a.amount) from public.allocation a where a.invoice_id = new.id), 0) then
      raise exception 'invoice_paid_amount_derived' using errcode = 'TL055';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if new.number is distinct from old.number then
      if coalesce(public.current_app_role(), '') <> 'owner' or not exists (
        select 1 from public.invoice_number_correction c
        where c.invoice_id = old.id and c.old_number = old.number and c.new_number = new.number
          and c.transaction_id = pg_current_xact_id()::text and c.created_by = auth.uid()
      ) or (to_jsonb(new) - array['number','snapshot','revision','updated_at'])
         is distinct from (to_jsonb(old) - array['number','snapshot','revision','updated_at'])
        or ((new.snapshot - 'revision') #- '{doc,number}') is distinct from ((old.snapshot - 'revision') #- '{doc,number}')
        or new.snapshot #>> '{doc,number}' is distinct from new.number
        or new.snapshot ->> 'revision' is distinct from new.revision::text then
        raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'signed-number reconciliation required';
      end if;
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
    -- Payment statuses follow paid_amount both ways (an allocation may be removed).
    if old.status in ('issued', 'partially_paid', 'paid') and new.status in ('issued', 'partially_paid', 'paid') then
      v_allowed := array[case
        when new.paid_amount >= new.total and new.paid_amount > 0 then 'paid'
        when new.paid_amount > 0 then 'partially_paid'
        else 'issued' end];
    end if;
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


create or replace function public.reconcile_invoice_numbers(p_items jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_invoice public.invoice;
  v_document public.document;
  v_number text;
  v_results jsonb := '[]';
begin
  if coalesce(public.current_app_role(), '') <> 'owner' or auth.uid() is null then
    raise exception 'owner required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50
     or coalesce(trim(p_reason), '') = '' then
    raise exception 'invalid reconciliation input' using errcode = '23514';
  end if;
  if (select count(distinct x ->> 'invoiceId') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items)
     or (select count(distinct x ->> 'number') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'duplicate reconciliation target' using errcode = '23514';
  end if;
  -- Stable lock order prevents concurrent reconciliations from swapping against stale values.
  perform 1 from public.invoice i where i.id in (
    select (x ->> 'invoiceId')::uuid from jsonb_array_elements(p_items) x
  ) order by i.id for update;
  perform set_config('app.reason', p_reason, true);
  set constraints public.invoice_number_key deferred;
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_invoice from public.invoice where id = (v_item ->> 'invoiceId')::uuid;
    v_number := trim(v_item ->> 'number');
    if v_invoice.id is null or v_invoice.number is distinct from v_item ->> 'expectedNumber'
       or v_invoice.status <> 'issued' or v_invoice.paid_amount <> 0 or v_invoice.snapshot is null
       or v_number is null or length(v_number) not between 1 and 100
       or v_invoice.total is distinct from (v_item ->> 'signedTotal')::numeric
       or v_invoice.currency is distinct from v_item ->> 'signedCurrency' then
      raise exception 'invoice changed or signed totals differ' using errcode = 'TL005';
    end if;
    select d.* into v_document from public.document d
      join public.document_link l on l.document_id = d.id and l.entity_type = 'invoice' and l.entity_id = v_invoice.id
      where d.id = (v_item ->> 'signedDocumentId')::uuid for update of d;
    if v_document.id is null or v_document.type <> 'invoice' or v_document.status <> 'issued'
       or v_document.signed_at is null or v_document.drive_file_id is null
       or v_document.source_revision is distinct from v_invoice.revision
       or exists (select 1 from public.document d where d.supersedes_id = v_document.id) then
      raise exception 'current attached signed copy required' using errcode = '23514';
    end if;
    if v_number = v_invoice.number then
      if v_document.number is distinct from v_number then
        raise exception 'signed metadata mismatch' using errcode = '23514';
      end if;
    else
      insert into public.invoice_number_correction(invoice_id, signed_document_id, old_number, new_number, reason)
        values (v_invoice.id, v_document.id, v_invoice.number, v_number, p_reason);
      update public.invoice set number = v_number, revision = revision + 1,
        snapshot = jsonb_set(jsonb_set(snapshot, '{doc,number}', to_jsonb(v_number)), '{revision}', to_jsonb(revision + 1))
        where id = v_invoice.id;
      update public.document set number = v_number, title = 'Invoice ' || v_number || ' (signed)',
        source_revision = v_invoice.revision + 1 where id = v_document.id;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'id', v_invoice.id, 'oldNumber', v_invoice.number, 'number', v_number,
      'signedDocumentId', v_document.id, 'revision', v_invoice.revision + case when v_number = v_invoice.number then 0 else 1 end
    ));
  end loop;
  -- Fail in this call, including dry runs, rather than discovering a duplicate at commit.
  set constraints public.invoice_number_key immediate;
  return v_results;
end;
$$;
revoke all on function public.reconcile_invoice_numbers(jsonb, text) from public, anon;
grant execute on function public.reconcile_invoice_numbers(jsonb, text) to authenticated;
