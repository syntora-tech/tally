-- Editing a transaction (A-061) may change its postings or type after money was allocated.
-- guard_allocation checks allocations only when they change, so the same I7 limits are re-checked
-- at commit for the edited side: Σ allocations ≤ main posting, currencies, invoices paid by revenue.
create or replace function public.check_transaction_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tx uuid;
  v_type public.tx_type;
  v_main numeric;
  v_main_currency text;
  v_used numeric;
begin
  if tg_table_name = 'posting' then
    v_tx := coalesce(new.transaction_id, old.transaction_id);
  else
    v_tx := new.id;
  end if;
  select t.type into v_type from public.transaction t where t.id = v_tx;
  -- Deleted together with its transaction (allocations cascade): nothing left to check.
  if v_type is null or not exists (select 1 from public.allocation a where a.transaction_id = v_tx) then
    return null;
  end if;

  select abs(p.amount), p.currency into v_main, v_main_currency
    from public.posting p where p.transaction_id = v_tx and not p.is_fee
   order by abs(p.amount) desc limit 1;
  if v_main is null then
    raise exception 'allocation_without_posting' using errcode = 'TL050';
  end if;
  if exists (select 1 from public.allocation a
              where a.transaction_id = v_tx and a.fx_rate is null
                and not public.same_currency(v_main_currency, a.currency)) then
    raise exception 'allocation_fx_rate_required' using errcode = 'TL051',
      detail = format('%s', v_main_currency);
  end if;
  if v_type <> 'revenue' and exists (select 1 from public.allocation a
                                      where a.transaction_id = v_tx and a.invoice_id is not null) then
    raise exception 'allocation_type_mismatch' using errcode = 'TL052', detail = 'invoices are paid by revenue';
  end if;
  select coalesce(sum(a.amount * coalesce(a.fx_rate, 1)), 0) into v_used
    from public.allocation a where a.transaction_id = v_tx;
  if v_used > v_main then
    raise exception 'allocation_exceeds_transaction' using errcode = 'TL054',
      detail = format('%s', v_used);
  end if;
  return null;
end;
$$;

create constraint trigger check_transaction_allocations
  after insert or update or delete on public.posting
  deferrable initially deferred
  for each row execute function public.check_transaction_allocations();

create constraint trigger check_transaction_allocations
  after update of type on public.transaction
  deferrable initially deferred
  for each row execute function public.check_transaction_allocations();
