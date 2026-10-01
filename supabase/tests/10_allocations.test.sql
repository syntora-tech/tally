begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(11);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000010', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000010', 'Client 10');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000010', 'client', 'C-10', '10000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000010');
insert into public.invoice (id, client_id, contract_id, issue_date, due_date, total)
  values ('b0000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000010',
          '2033-04-01', '2033-04-20', 1000);
insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
  values ('b0000000-0000-0000-0000-000000000010', 1, 'Dev', 'Розробка', 1, 1000, 1000);

insert into public.account (id, name, kind, currency, opening_date) values
  ('a1000000-0000-0000-0000-000000000001', 'T10 USD', 'bank', 'USD', '2033-01-01'),
  ('a1000000-0000-0000-0000-000000000002', 'T10 USDT', 'crypto', 'USDT', '2033-01-01'),
  ('a1000000-0000-0000-0000-000000000003', 'T10 UAH', 'bank', 'UAH', '2033-01-01');

create function pg_temp.revenue(p_id uuid, p_account uuid, p_amount numeric, p_currency text) returns void language plpgsql as $$
begin
  insert into public.transaction (id, occurred_on, type, category_id)
    select p_id, '2033-04-10', 'revenue', c.id from public.category c where c.tx_type = 'revenue' and c.name = 'Client Revenue';
  insert into public.posting (transaction_id, account_id, amount, currency) values (p_id, p_account, p_amount, p_currency);
end $$;

select pg_temp.revenue('c1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 600, 'USD');
select pg_temp.revenue('c1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 500, 'USDT');
select pg_temp.revenue('c1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000003', 20000, 'UAH');

select throws_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000001', 600, 'USD', 'b0000000-0000-0000-0000-000000000010') $$,
  'TL052', null, 'a draft invoice cannot be paid');
update public.invoice set status = 'issued', number = 'A-10/33', snapshot = '{}' where id = 'b0000000-0000-0000-0000-000000000010';

select throws_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000001', 700, 'USD', 'b0000000-0000-0000-0000-000000000010') $$,
  'TL054', null, 'I7: allocation cannot exceed the transaction');
insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000001', 600, 'USD', 'b0000000-0000-0000-0000-000000000010');
select is((select status::text || ' ' || paid_amount::numeric(20,2) from public.invoice where id = 'b0000000-0000-0000-0000-000000000010'),
  'partially_paid 600.00', 'partial payment updates paid_amount and status');

select throws_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000002', 500, 'USDT', 'b0000000-0000-0000-0000-000000000010') $$,
  'TL053', null, 'I7: allocations cannot exceed the invoice total');
select throws_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000003', 400, 'USD', 'b0000000-0000-0000-0000-000000000010') $$,
  'TL051', null, 'a UAH payment needs an exchange rate');
select lives_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id, fx_rate, fx_source)
  values ('c1000000-0000-0000-0000-000000000003', 400, 'USD', 'b0000000-0000-0000-0000-000000000010', 44.5, 'manual') $$,
  'UAH payment with a rate: 400 × 44.5 ≤ 20 000');
select is((select status::text from public.invoice where id = 'b0000000-0000-0000-0000-000000000010'), 'paid', 'full payment → paid');

delete from public.allocation where transaction_id = 'c1000000-0000-0000-0000-000000000003';
select is((select status::text || ' ' || paid_amount::numeric(20,2) from public.invoice where id = 'b0000000-0000-0000-0000-000000000010'),
  'partially_paid 600.00', 'removing an allocation moves the status back');

select lives_ok($$ insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1000000-0000-0000-0000-000000000002', 400, 'USDT', 'b0000000-0000-0000-0000-000000000010') $$,
  'USDT settles USD one to one');
select throws_ok($$ insert into public.allocation (transaction_id, amount, currency)
  values ('c1000000-0000-0000-0000-000000000002', 1, 'USD') $$, '23514', null, 'I9: exactly one target');
select throws_ok($$ update public.invoice set total = 1, revision = 2 where id = 'b0000000-0000-0000-0000-000000000010' $$,
  'TL001', null, 'a paid invoice cannot be revised');

select * from finish();
rollback;
