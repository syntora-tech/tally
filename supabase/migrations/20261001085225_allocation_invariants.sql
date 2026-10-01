select public.setup_app_table('public.fx_rate');
select public.setup_app_table('public.allocation');

-- USD-pegged stablecoins settle USD amounts one to one (spec 5.4, Q15).
create or replace function public.same_currency(a text, b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a = b or (a in ('USD', 'USDT', 'USDC') and b in ('USD', 'USDT', 'USDC'))
$$;

grant execute on function public.same_currency(text, text) to authenticated, service_role;

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

-- Recomputes paid_amount and the payment status of an invoice from its allocations (I7).
create or replace function public.refresh_invoice_payment(p_invoice uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_paid numeric;
begin
  select coalesce(sum(a.amount), 0) into v_paid from public.allocation a where a.invoice_id = p_invoice;
  update public.invoice i
     set paid_amount = v_paid,
         status = case
           when i.status not in ('issued', 'partially_paid', 'paid') then i.status
           when v_paid >= i.total and v_paid > 0 then 'paid'::public.invoice_status
           when v_paid > 0 then 'partially_paid'::public.invoice_status
           else 'issued'::public.invoice_status end
   where i.id = p_invoice and i.paid_amount is distinct from v_paid;
end;
$$;

-- I7 limits: Σ per invoice ≤ total; Σ per transaction (in its currency) ≤ its main posting.
create or replace function public.guard_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type public.tx_type;
  v_main numeric;
  v_main_currency text;
  v_invoice public.invoice;
  v_used numeric;
begin
  select t.type into v_type from public.transaction t where t.id = new.transaction_id;
  select abs(p.amount), p.currency into v_main, v_main_currency
    from public.posting p where p.transaction_id = new.transaction_id and not p.is_fee
   order by abs(p.amount) desc limit 1;
  if v_main is null then
    raise exception 'allocation_without_posting' using errcode = 'TL050';
  end if;
  if not public.same_currency(v_main_currency, new.currency) and new.fx_rate is null then
    raise exception 'allocation_fx_rate_required' using errcode = 'TL051',
      detail = format('%s → %s', v_main_currency, new.currency);
  end if;

  if new.invoice_id is not null then
    select * into v_invoice from public.invoice i where i.id = new.invoice_id for update;
    if v_type <> 'revenue' then
      raise exception 'allocation_type_mismatch' using errcode = 'TL052', detail = 'invoices are paid by revenue';
    end if;
    if v_invoice.status not in ('issued', 'partially_paid', 'paid') then
      raise exception 'allocation_invoice_not_payable' using errcode = 'TL052', detail = v_invoice.status::text;
    end if;
    if not public.same_currency(v_invoice.currency, new.currency) then
      raise exception 'allocation_currency_mismatch' using errcode = 'TL051',
        detail = format('%s ≠ %s', new.currency, v_invoice.currency);
    end if;
    select coalesce(sum(a.amount), 0) into v_used from public.allocation a
     where a.invoice_id = new.invoice_id and a.id <> new.id;
    if v_used + new.amount > v_invoice.total then
      raise exception 'allocation_exceeds_invoice' using errcode = 'TL053',
        detail = format('%s', v_invoice.total - v_used);
    end if;
  end if;

  select coalesce(sum(a.amount * coalesce(a.fx_rate, 1)), 0) into v_used from public.allocation a
   where a.transaction_id = new.transaction_id and a.id <> new.id;
  if v_used + new.amount * coalesce(new.fx_rate, 1) > v_main then
    raise exception 'allocation_exceeds_transaction' using errcode = 'TL054',
      detail = format('%s', v_main - v_used);
  end if;
  return new;
end;
$$;

create trigger guard_allocation
  before insert or update on public.allocation
  for each row execute function public.guard_allocation();

create or replace function public.after_allocation_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' and old.invoice_id is not null then
    perform public.refresh_invoice_payment(old.invoice_id);
  end if;
  if tg_op <> 'DELETE' and new.invoice_id is not null
     and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id) then
    perform public.refresh_invoice_payment(new.invoice_id);
  end if;
  return null;
end;
$$;

create trigger after_allocation_change
  after insert or update or delete on public.allocation
  for each row execute function public.after_allocation_change();
