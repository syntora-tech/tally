begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000015', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000015', 'Client 15');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000015', 'Person 15');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000015', 'client', 'C-15', '10000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000015');
insert into public.invoice (id, client_id, contract_id, issue_date, due_date, total)
  values ('b0000000-0000-0000-0000-000000000015', '40000000-0000-0000-0000-000000000015', '50000000-0000-0000-0000-000000000015',
          '2034-04-03', '2034-04-20', 1000);
insert into public.invoice_line (invoice_id, position, description_en, description_ua, quantity, unit_price, amount)
  values ('b0000000-0000-0000-0000-000000000015', 1, 'Dev', 'Розробка', 1, 1000, 1000);
update public.invoice set status = 'issued', number = 'A-15/34', snapshot = '{}' where id = 'b0000000-0000-0000-0000-000000000015';
insert into public.account (id, name, kind, currency, opening_date) values
  ('a1500000-0000-0000-0000-000000000001', 'T15 USD', 'bank', 'USD', '2034-01-01'),
  ('a1500000-0000-0000-0000-000000000002', 'T15 UAH', 'bank', 'UAH', '2034-01-01');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'c1500000-0000-0000-0000-000000000001', '2034-04-10', 'revenue', c.id
    from public.category c where c.tx_type = 'revenue' and c.name = 'Client Revenue';
insert into public.posting (id, transaction_id, account_id, amount, currency)
  values ('d1500000-0000-0000-0000-000000000001', 'c1500000-0000-0000-0000-000000000001', 'a1500000-0000-0000-0000-000000000001', 600, 'USD');
insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c1500000-0000-0000-0000-000000000001', 500, 'USD', 'b0000000-0000-0000-0000-000000000015');

-- Party link: at most one of person and client.
select throws_ok($$ update public.transaction set person_id = '20000000-0000-0000-0000-000000000015',
  client_id = '40000000-0000-0000-0000-000000000015' where id = 'c1500000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a transaction is linked to one party at most');
select lives_ok($$ update public.transaction set client_id = '40000000-0000-0000-0000-000000000015'
  where id = 'c1500000-0000-0000-0000-000000000001' $$, 'link a transaction to a client');

-- Edits of an allocated transaction are re-checked against its allocations.
set constraints all immediate;
select throws_ok($$ update public.posting set amount = 400 where id = 'd1500000-0000-0000-0000-000000000001' $$,
  'TL054', null, 'the amount cannot drop below what is allocated');
select lives_ok($$ update public.posting set amount = 550 where id = 'd1500000-0000-0000-0000-000000000001' $$,
  'the amount can change while allocations still fit');
select throws_ok($$ update public.posting set account_id = 'a1500000-0000-0000-0000-000000000002', currency = 'UAH'
  where id = 'd1500000-0000-0000-0000-000000000001' $$,
  'TL051', null, 'moving to another currency needs rates on the allocations');
select throws_ok($$ update public.transaction set type = 'expense',
  category_id = (select id from public.category where tx_type = 'expense' and name = 'Bad Debt')
  where id = 'c1500000-0000-0000-0000-000000000001' $$,
  'TL052', null, 'an invoice payment stays revenue');
select lives_ok($$ delete from public.transaction where id = 'c1500000-0000-0000-0000-000000000001' $$,
  'deleting the transaction with its allocations is not blocked by the edit guard');

select * from finish();
rollback;
