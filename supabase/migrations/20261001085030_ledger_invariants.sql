select public.setup_app_table('public.account');
select public.setup_app_table('public.category');
select public.setup_app_table('public.transaction');
select public.setup_app_table('public.posting');

-- I4: a posting is always in its account's currency.
create or replace function public.guard_posting_currency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_currency text;
begin
  select a.currency into v_currency from public.account a where a.id = new.account_id;
  if new.currency is distinct from v_currency then
    raise exception 'posting_currency_mismatch' using errcode = 'TL040',
      detail = format('%s ≠ %s', new.currency, v_currency);
  end if;
  return new;
end;
$$;

create trigger guard_posting_currency
  before insert or update on public.posting
  for each row execute function public.guard_posting_currency();

-- I5: transaction shape, checked at commit so a transaction and its postings can be written in
-- any order. Fees are always negative; non-fee postings by type:
--   revenue +, expense −, adjustment ±: exactly one; transfer / fx_exchange / crypto_*: one − and one +.
create or replace function public.check_transaction_shape(p_transaction uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_type public.tx_type;
  v_pos int;
  v_neg int;
  v_bad_fee int;
begin
  select t.type into v_type from public.transaction t where t.id = p_transaction;
  if not found then
    return;
  end if;
  select count(*) filter (where not p.is_fee and p.amount > 0),
         count(*) filter (where not p.is_fee and p.amount < 0),
         count(*) filter (where p.is_fee and p.amount >= 0)
    into v_pos, v_neg, v_bad_fee
    from public.posting p where p.transaction_id = p_transaction;

  if v_bad_fee > 0
     or (v_type = 'revenue' and not (v_pos = 1 and v_neg = 0))
     or (v_type = 'expense' and not (v_pos = 0 and v_neg = 1))
     or (v_type = 'adjustment' and v_pos + v_neg <> 1)
     or (v_type in ('transfer', 'fx_exchange', 'crypto_buy', 'crypto_sell', 'crypto_swap')
         and not (v_pos = 1 and v_neg = 1)) then
    raise exception 'transaction_shape_invalid' using errcode = 'TL041',
      detail = format('%s: %s positive, %s negative, %s non-negative fees', v_type, v_pos, v_neg, v_bad_fee);
  end if;
end;
$$;

create or replace function public.check_transaction_shape_trigger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'transaction' then
    perform public.check_transaction_shape(coalesce(new.id, old.id));
  else
    perform public.check_transaction_shape(coalesce(new.transaction_id, old.transaction_id));
    if tg_op = 'UPDATE' and new.transaction_id is distinct from old.transaction_id then
      perform public.check_transaction_shape(old.transaction_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger check_transaction_shape
  after insert or update or delete on public.posting
  deferrable initially deferred
  for each row execute function public.check_transaction_shape_trigger();

create constraint trigger check_transaction_shape
  after insert or update of type on public.transaction
  deferrable initially deferred
  for each row execute function public.check_transaction_shape_trigger();

-- Balance per account for lists and reconciliation (8.3); RLS of the base tables applies.
create view public.account_balance with (security_invoker = true) as
select a.id as account_id,
       a.opening_balance + coalesce(sum(p.amount), 0) as balance
  from public.account a
  left join public.posting p on p.account_id = a.id
 group by a.id;

grant select on public.account_balance to authenticated;

-- Reference categories (legacy `Categories` sheet + Bad Debt, spec 5.3 rule 7, 6.7).
insert into public.category (tx_type, name) values
  ('revenue', 'Client Revenue'),
  ('revenue', 'Interest / Other Income'),
  ('expense', 'Payroll'),
  ('expense', 'Contractors'),
  ('expense', 'Taxes'),
  ('expense', 'Software / Tools'),
  ('expense', 'Marketing'),
  ('expense', 'Bank Fees'),
  ('expense', 'Legal / Accounting'),
  ('expense', 'Office / Ops'),
  ('expense', 'Travel / Conf.'),
  ('expense', 'Bad Debt'),
  ('transfer', 'Internal Transfer'),
  ('fx_exchange', 'FX Exchange'),
  ('crypto_buy', 'Crypto Buy'),
  ('crypto_sell', 'Crypto Sell'),
  ('crypto_swap', 'Crypto Swap'),
  ('adjustment', 'Opening Balance Adjustment'),
  ('adjustment', 'Correction')
on conflict (tx_type, name) do nothing;
