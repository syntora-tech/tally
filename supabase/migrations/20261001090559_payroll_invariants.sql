select public.setup_app_table('public.payroll_item');
select public.setup_app_table('public.payroll_line');
select public.setup_app_table('public.adjustment');

-- Fiat payouts are made in UAH, crypto payouts in USD-pegged coins (5.2, A-050).
create or replace function public.payroll_item_currency(p_item public.payroll_item)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_item.payout_method = 'fiat' then 'UAH' else 'USD' end
$$;

create or replace function public.payroll_item_total(p_item public.payroll_item)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_item.payout_method = 'fiat' then p_item.total_uah else p_item.total_usd end
$$;

-- I6: adjustments and accrued amounts of a closed period are read-only.
create or replace function public.guard_adjustment_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.period p
              where p.id in (new.period_id, old.period_id) and p.status = 'closed') then
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_closed_period
  before insert or update or delete on public.adjustment
  for each row execute function public.guard_adjustment_closed_period();

create or replace function public.guard_payroll_line_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'DELETE' or new.amount_usd is distinct from old.amount_usd)
     and exists (select 1 from public.payroll_item i join public.period p on p.id = i.period_id
                  where i.id = old.payroll_item_id and p.status = 'closed') then
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_closed_period
  before update or delete on public.payroll_line
  for each row execute function public.guard_payroll_line_closed_period();

-- A period with payouts cannot be reopened: its payroll would no longer match the money paid.
create or replace function public.guard_period_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'open' then
    if coalesce(public.current_app_role(), '') <> 'owner'
       and coalesce(current_setting('app.actor', true), '') not like 'system:%' then
      raise exception 'only owner can reopen a period' using errcode = '42501';
    end if;
    if coalesce(trim(current_setting('app.reason', true)), '') = '' then
      raise exception 'period_reopen_reason_required' using errcode = 'TL031';
    end if;
    if exists (select 1 from public.allocation a join public.payroll_item i on i.id = a.payroll_item_id
                where i.period_id = old.id) then
      raise exception 'period_has_payouts' using errcode = 'TL032';
    end if;
  end if;
  return new;
end;
$$;

-- Item status from lines and payments (5.3 rule 6).
create or replace function public.refresh_payroll_item(p_item uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item public.payroll_item;
  v_paid numeric;
  v_total numeric;
  v_lines int;
  v_ready int;
  v_status public.payroll_item_status;
begin
  select * into v_item from public.payroll_item i where i.id = p_item;
  if not found then
    return;
  end if;
  select coalesce(sum(a.amount), 0) into v_paid from public.allocation a where a.payroll_item_id = p_item;
  v_total := public.payroll_item_total(v_item);
  select count(*), count(*) filter (where l.status in ('payable', 'paid'))
    into v_lines, v_ready from public.payroll_line l where l.payroll_item_id = p_item;

  if v_paid > 0 and v_total is not null and v_paid >= v_total then
    v_status := 'paid';
    update public.payroll_line l set status = 'paid', funding_source = coalesce(l.funding_source, 'company')
     where l.payroll_item_id = p_item and l.status <> 'paid';
  elsif v_paid > 0 then
    v_status := 'partially_paid';
  elsif v_ready = v_lines then
    -- Includes items made only of adjustments: nothing waits for a client.
    v_status := 'payable';
  elsif v_ready > 0 then
    v_status := 'partially_payable';
  else
    v_status := 'draft';
  end if;

  update public.payroll_item i set paid_amount = v_paid, status = v_status
   where i.id = p_item and (i.paid_amount is distinct from v_paid or i.status is distinct from v_status);
end;
$$;

-- 5.3: once the client has paid the invoice in full, its lines become payable at the client's
-- expense. Lines already payable keep their funding source (rule 4).
create or replace function public.release_client_funded_lines(p_invoice uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_item uuid;
begin
  if not exists (select 1 from public.invoice i where i.id = p_invoice and i.paid_amount >= i.total and i.total > 0) then
    return;
  end if;
  for v_item in
    update public.payroll_line l
       set status = 'payable', funding_source = 'client', payable_at = now()
      from public.invoice_line il
     where il.id = l.funded_by_invoice_line_id and il.invoice_id = p_invoice
       and l.status in ('accrued', 'awaiting_client')
    returning l.payroll_item_id
  loop
    perform public.refresh_payroll_item(v_item);
  end loop;
end;
$$;

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
  perform public.release_client_funded_lines(p_invoice);
end;
$$;

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

  select coalesce(sum(a.amount * coalesce(a.fx_rate, 1)), 0) into v_used from public.allocation a
   where a.transaction_id = new.transaction_id and a.id <> new.id;
  if v_used + new.amount * coalesce(new.fx_rate, 1) > v_main then
    raise exception 'allocation_exceeds_transaction' using errcode = 'TL054',
      detail = format('%s', v_main - v_used);
  end if;
  return new;
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
  return null;
end;
$$;
