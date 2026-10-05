select public.setup_app_table('public.trip');
select public.setup_app_table('public.trip_participant');
select public.setup_app_table('public.trip_expense');
select public.setup_app_table('public.reimbursement');

-- Same guard as before, plus allocations to trip reimbursements (A-070).
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
  v_item public.payroll_item;
  v_item_total numeric;
  v_reimbursement public.reimbursement;
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

  if new.payroll_item_id is not null then
    select * into v_item from public.payroll_item i where i.id = new.payroll_item_id for update;
    if v_type <> 'expense' then
      raise exception 'allocation_type_mismatch' using errcode = 'TL052', detail = 'payouts are expenses';
    end if;
    if not public.same_currency(public.payroll_item_currency(v_item), new.currency) then
      raise exception 'allocation_currency_mismatch' using errcode = 'TL051',
        detail = format('%s ≠ %s', new.currency, public.payroll_item_currency(v_item));
    end if;
    v_item_total := public.payroll_item_total(v_item);
    if v_item_total is null then
      raise exception 'payroll_rate_required' using errcode = 'TL056';
    end if;
    select coalesce(sum(a.amount), 0) into v_used from public.allocation a
     where a.payroll_item_id = new.payroll_item_id and a.id <> new.id;
    if v_used + new.amount > v_item_total then
      raise exception 'allocation_exceeds_payroll' using errcode = 'TL053',
        detail = format('%s', v_item_total - v_used);
    end if;
  end if;

  -- A-070: a trip reimbursement is paid by expenses in UAH, up to its amount.
  if new.reimbursement_id is not null then
    select * into v_reimbursement from public.reimbursement r where r.id = new.reimbursement_id for update;
    if v_type <> 'expense' then
      raise exception 'allocation_type_mismatch' using errcode = 'TL052', detail = 'reimbursements are expenses';
    end if;
    if new.currency <> v_reimbursement.currency then
      raise exception 'allocation_currency_mismatch' using errcode = 'TL051',
        detail = format('%s ≠ %s', new.currency, v_reimbursement.currency);
    end if;
    select coalesce(sum(a.amount), 0) into v_used from public.allocation a
     where a.reimbursement_id = new.reimbursement_id and a.id <> new.id;
    if v_used + new.amount > v_reimbursement.amount then
      raise exception 'allocation_exceeds_reimbursement' using errcode = 'TL053',
        detail = format('%s', v_reimbursement.amount - v_used);
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
