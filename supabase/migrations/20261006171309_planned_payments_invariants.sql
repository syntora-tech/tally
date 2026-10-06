select public.setup_app_table('public.planned_expense_part');
select public.setup_app_table('public.payment_charge');
select public.setup_app_table('public.planned_payment');

-- Same guard as before, plus allocations to planned payments (A-082).
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
  v_planned public.planned_payment;
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

  -- A-082: a planned payment is paid by expenses in its currency; the actual amount may differ
  -- from the plan (salary rest, taxes), so there is no upper limit.
  if new.planned_payment_id is not null then
    select * into v_planned from public.planned_payment p where p.id = new.planned_payment_id for update;
    if v_type <> 'expense' then
      raise exception 'allocation_type_mismatch' using errcode = 'TL052', detail = 'planned payments are expenses';
    end if;
    if v_planned.status = 'skipped' then
      raise exception 'allocation_planned_skipped' using errcode = 'TL052', detail = 'skipped';
    end if;
    if not public.same_currency(v_planned.currency, new.currency) then
      raise exception 'allocation_currency_mismatch' using errcode = 'TL051',
        detail = format('%s ≠ %s', new.currency, v_planned.currency);
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

-- A planned payment is `paid` exactly while Ledger expenses are allocated to it (A-082).
create or replace function public.refresh_planned_payment(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_paid boolean := exists (select 1 from public.allocation a where a.planned_payment_id = p_id);
begin
  perform set_config('app.planned_refresh', 'on', true);
  update public.planned_payment p
     set status = case when v_paid then 'paid'::public.planned_payment_status
                       when p.status = 'paid' then 'due'::public.planned_payment_status
                       else p.status end
   where p.id = p_id
     and p.status is distinct from case when v_paid then 'paid'::public.planned_payment_status
                                        when p.status = 'paid' then 'due'::public.planned_payment_status
                                        else p.status end;
  perform set_config('app.planned_refresh', 'off', true);
end;
$$;

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
  if tg_op <> 'INSERT' and old.payroll_item_id is not null then
    perform public.refresh_payroll_item(old.payroll_item_id);
  end if;
  if tg_op <> 'DELETE' and new.payroll_item_id is not null
     and (tg_op = 'INSERT' or new.payroll_item_id is distinct from old.payroll_item_id) then
    perform public.refresh_payroll_item(new.payroll_item_id);
  end if;
  if tg_op <> 'INSERT' and old.planned_payment_id is not null then
    perform public.refresh_planned_payment(old.planned_payment_id);
  end if;
  if tg_op <> 'DELETE' and new.planned_payment_id is not null
     and (tg_op = 'INSERT' or new.planned_payment_id is distinct from old.planned_payment_id) then
    perform public.refresh_planned_payment(new.planned_payment_id);
  end if;
  return null;
end;
$$;

-- A paid planned payment is a record of money: its amount, currency and date are fixed, it cannot
-- be skipped or deleted, and `paid` is never set by hand. SQLSTATE TL064 is mapped by the services.
create or replace function public.guard_planned_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'paid' then
      raise exception 'planned_payment_paid' using errcode = 'TL064';
    end if;
    return old;
  end if;
  if coalesce(current_setting('app.planned_refresh', true), 'off') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'paid' then
    raise exception 'planned_payment_paid' using errcode = 'TL064', detail = 'status';
  end if;
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status and 'paid' in (new.status, old.status) then
      raise exception 'planned_payment_paid' using errcode = 'TL064', detail = 'status';
    end if;
    if old.status = 'paid' and (new.amount, new.currency, new.gross, new.due_on, new.month)
                               is distinct from (old.amount, old.currency, old.gross, old.due_on, old.month) then
      raise exception 'planned_payment_paid' using errcode = 'TL064';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_planned_payment
  before insert or update or delete on public.planned_payment
  for each row execute function public.guard_planned_payment();
