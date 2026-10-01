begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner9@t.local'),
  ('00000000-0000-0000-0000-0000000000c9', 'viewer9@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000a9', 'owner9@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000c9', 'viewer9@t.local', 'viewer');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

insert into public.account (id, name, kind, currency, opening_balance, opening_date) values
  ('a9000000-0000-0000-0000-000000000001', 'T9 USD', 'bank', 'USD', 100, '2032-01-01'),
  ('a9000000-0000-0000-0000-000000000002', 'T9 UAH', 'bank', 'UAH', 0, '2032-01-01');

create function pg_temp.cat(p_type public.tx_type, p_name text) returns uuid language sql as $$
  select id from public.category where tx_type = p_type and name = p_name
$$;

-- I4
insert into public.transaction (id, occurred_on, type, category_id)
  values ('b9000000-0000-0000-0000-000000000001', '2032-01-05', 'revenue', pg_temp.cat('revenue', 'Client Revenue'));
select throws_ok($$ insert into public.posting (transaction_id, account_id, amount, currency)
  values ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 50, 'EUR') $$,
  'TL040', null, 'posting currency must match the account (I4)');

-- I5: revenue needs one positive posting; checked at commit (forced here with SET CONSTRAINTS).
select throws_ok($$ set constraints all immediate $$, 'TL041', null, 'revenue without postings is rejected');
set constraints all deferred;
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 50, 'USD');
select lives_ok($$ set constraints all immediate $$, 'revenue with one positive posting is valid');
set constraints all deferred;

insert into public.posting (transaction_id, account_id, amount, currency, is_fee)
  values ('b9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 1, 'USD', true);
select throws_ok($$ set constraints all immediate $$, 'TL041', null, 'fees are always negative');
set constraints all deferred;
delete from public.posting where transaction_id = 'b9000000-0000-0000-0000-000000000001' and is_fee;

-- fx_exchange: one negative and one positive leg, plus an optional negative fee.
insert into public.transaction (id, occurred_on, type, category_id)
  values ('b9000000-0000-0000-0000-000000000002', '2032-01-06', 'fx_exchange', pg_temp.cat('fx_exchange', 'FX Exchange'));
insert into public.posting (transaction_id, account_id, amount, currency, is_fee) values
  ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001', -20, 'USD', false),
  ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 861, 'UAH', false),
  ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', -5, 'UAH', true);
select lives_ok($$ set constraints all immediate $$, 'exchange with two legs and a fee is valid');
set constraints all deferred;

insert into public.posting (transaction_id, account_id, amount, currency)
  values ('b9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000002', 10, 'UAH');
select throws_ok($$ set constraints all immediate $$, 'TL041', null, 'exchange with a third leg is rejected');
set constraints all deferred;
delete from public.posting where transaction_id = 'b9000000-0000-0000-0000-000000000002' and amount = 10;

select throws_ok($$ update public.transaction set type = 'expense'
  where id = 'b9000000-0000-0000-0000-000000000001' $$,
  '23503', null, 'the category must belong to the transaction type');

select is((select balance::numeric(20,2) from public.account_balance where account_id = 'a9000000-0000-0000-0000-000000000001'),
  130.00, 'balance = opening + postings (100 + 50 − 20)');
select is((select balance::numeric(20,2) from public.account_balance where account_id = 'a9000000-0000-0000-0000-000000000002'),
  856.00, 'fees reduce the balance');

select ok((select count(*) from public.category where name = 'Bad Debt' and tx_type = 'expense') = 1,
  'reference categories include Bad Debt');

-- RLS: viewers see no Ledger.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c9');
select is((select count(*)::int from public.posting), 0, 'viewer reads no postings');
select is((select count(*)::int from public.account), 0, 'viewer reads no accounts');
reset role;

select * from finish();
rollback;
