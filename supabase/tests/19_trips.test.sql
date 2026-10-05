begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(15);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000019c1', 'viewer19@t.local');
insert into public.app_user (id, email, role) values ('00000000-0000-0000-0000-0000000019c1', 'viewer19@t.local', 'viewer');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.reset_actor() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

insert into public.person (id, full_name) values
  ('20000000-0000-0000-0000-000000000019', 'Traveller 19'),
  ('20000000-0000-0000-0000-000000000119', 'Stay-at-home 19');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000019', 'fop', 'ФОП 19');

select throws_ok($$ insert into public.trip (title) values ('No dates') $$, '23514', null, 'a new trip needs dates');
select lives_ok($$ insert into public.trip (legacy_ref, title) values ('t19:legacy', 'Legacy without dates') $$,
  'a legacy trip may lack dates');
insert into public.trip (id, title, starts_on, ends_on) values ('70000000-0000-0000-0000-000000000019', 'Conf 19', '2036-05-10', '2036-05-12');
insert into public.trip_participant (trip_id, person_id) values ('70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019');

select lives_ok($$ insert into public.trip_expense (trip_id, person_id, spent_on, description, amount, currency, fx_rate, amount_uah, amount_usd)
  values ('70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019', '2036-05-10', 'Hotel', 100, 'EUR', 50, 5000, 116) $$,
  'a participant expense');
select throws_ok($$ insert into public.trip_expense (trip_id, person_id, spent_on, description, amount, currency, fx_rate, amount_uah, amount_usd)
  values ('70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000119', '2036-05-10', 'Hotel', 100, 'EUR', 50, 5000, 116) $$,
  '23503', null, 'only participants have expenses');
select throws_ok($$ insert into public.trip_expense (trip_id, person_id, spent_on, description, amount, currency, fx_rate, amount_uah, amount_usd, paid_by, reimbursable)
  values ('70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019', '2036-05-10', 'Ticket', 10, 'USD', 41, 410, 10, 'company', true) $$,
  '23514', null, 'what the company paid is not reimbursed');
select throws_ok($$ insert into public.reimbursement (trip_id, person_id, amount, method)
  values ('70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019', 5000, 'act') $$,
  '23514', null, 'an act reimbursement names the payee');

insert into public.reimbursement (id, trip_id, person_id, payee_id, amount, method)
  values ('71000000-0000-0000-0000-000000000019', '70000000-0000-0000-0000-000000000019', '20000000-0000-0000-0000-000000000019',
          '30000000-0000-0000-0000-000000000019', 5000, 'direct_payment');

-- Allocations: a reimbursement is paid by a UAH expense up to its amount (A-070).
insert into public.account (id, name, kind, currency, opening_date) values
  ('a1000000-0000-0000-0000-000000000019', 'UAH 19', 'bank', 'UAH', '2036-01-01');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'a2000000-0000-0000-0000-000000000019', '2036-05-20', 'expense', id from public.category where tx_type = 'expense' and name = 'Travel / Conf.';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('a2000000-0000-0000-0000-000000000019', 'a1000000-0000-0000-0000-000000000019', -6000, 'UAH');
select throws_ok($$ insert into public.allocation (transaction_id, reimbursement_id, amount, currency)
  values ('a2000000-0000-0000-0000-000000000019', '71000000-0000-0000-0000-000000000019', 5001, 'UAH') $$,
  'TL053', null, 'not more than the reimbursement');
select lives_ok($$ insert into public.allocation (transaction_id, reimbursement_id, amount, currency)
  values ('a2000000-0000-0000-0000-000000000019', '71000000-0000-0000-0000-000000000019', 5000, 'UAH') $$,
  'the expense pays the reimbursement');
select throws_ok($$ insert into public.allocation (transaction_id, amount, currency)
  values ('a2000000-0000-0000-0000-000000000019', 1, 'UAH') $$,
  '23514', null, 'an allocation has exactly one target');

-- A legacy act may be reclassified as the reimbursement it was; its link is set once.
insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000019', 'S', 'С');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000019', 'fop', 'OD-19', '10000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000019');
insert into public.supplier_act (id, contract_id, payee_id, type, number, act_date, amount_uah, status, is_legacy, snapshot) values
  ('b1000000-0000-0000-0000-000000000019', '50000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000019', 'monthly', '19 - А1', '2036-05-29', 5000, 'issued', true, null),
  ('b2000000-0000-0000-0000-000000000019', '50000000-0000-0000-0000-000000000019', '30000000-0000-0000-0000-000000000019', 'monthly', '19 - А2', '2036-05-29', 5000, 'issued', false, '{"doc":{}}');
select lives_ok($$ update public.supplier_act set type = 'reimbursement', reimbursement_id = '71000000-0000-0000-0000-000000000019'
  where id = 'b1000000-0000-0000-0000-000000000019' $$, 'a legacy act becomes the reimbursement it paid');
select throws_ok($$ update public.supplier_act set reimbursement_id = null where id = 'b1000000-0000-0000-0000-000000000019' $$,
  'TL001', null, 'the reimbursement of an issued act is set once');
select throws_ok($$ update public.supplier_act set type = 'reimbursement' where id = 'b2000000-0000-0000-0000-000000000019' $$,
  'TL001', null, 'a non-legacy issued act keeps its type');

-- Viewers see trips and participants but not the money.
select pg_temp.act_as('00000000-0000-0000-0000-0000000019c1');
select is((select count(*)::int from public.trip where id = '70000000-0000-0000-0000-000000000019'), 1, 'viewers see trips');
select is((select count(*)::int from public.trip_expense where trip_id = '70000000-0000-0000-0000-000000000019'), 0, 'viewers do not see expenses');
select pg_temp.reset_actor();

select ok(exists (select 1 from public.audit_log where table_name = 'trip_expense'), 'expenses are audited');

select * from finish();
rollback;
