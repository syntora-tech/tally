begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000012', 'S', 'С');
insert into public.payee (id, kind, legal_name_ua) values
  ('30000000-0000-0000-0000-000000000012', 'fop', 'ФОП Тест'),
  ('30000000-0000-0000-0000-000000000013', 'fop', 'ФОП Інший');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000012', 'fop', 'OD-9012', '10000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000012');

select throws_ok($$ insert into public.supplier_act (contract_id, payee_id, act_date, amount_uah)
  values ('50000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000013', '2034-08-31', 1) $$,
  'TL060', null, 'the act payee must be the contract payee');

insert into public.supplier_act (id, contract_id, payee_id, act_date, period_from, period_to, amount_uah)
  values ('e0000000-0000-0000-0000-000000000012', '50000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000012',
          '2034-09-02', '2034-08-01', '2034-08-31', 93174.60);

select throws_ok($$ update public.supplier_act set status = 'issued', number = '9012 - А1'
  where id = 'e0000000-0000-0000-0000-000000000012' $$, 'TL003', null, 'issue needs a snapshot');
select throws_ok($$ update public.supplier_act set status = 'issued', number = '9012 - А1', snapshot = '{}', act_date = '2034-09-02'
  where id = 'e0000000-0000-0000-0000-000000000012' $$, 'TL004', null, 'I3: Saturday act date is rejected');
select lives_ok($$ update public.supplier_act set status = 'issued', number = '9012 - А1', snapshot = '{}', act_date = '2034-08-31'
  where id = 'e0000000-0000-0000-0000-000000000012' $$, 'issue on a working day');
select throws_ok($$ update public.supplier_act set amount_uah = 1 where id = 'e0000000-0000-0000-0000-000000000012' $$,
  'TL001', null, 'I1: amount is frozen');
select lives_ok($$ update public.supplier_act set signed_url = 'https://vchasno.ua/x' where id = 'e0000000-0000-0000-0000-000000000012' $$,
  'the Vchasno link can be added later');
select throws_ok($$ delete from public.supplier_act where id = 'e0000000-0000-0000-0000-000000000012' $$,
  'TL001', null, 'I1: issued acts cannot be deleted');
select lives_ok($$ update public.supplier_act set status = 'void', void_reason = 'wrong amount' where id = 'e0000000-0000-0000-0000-000000000012' $$,
  'an act can be voided with a reason');

insert into public.supplier_act (contract_id, payee_id, act_date, amount_uah, is_legacy, status, number)
  values ('50000000-0000-0000-0000-000000000012', '30000000-0000-0000-0000-000000000012', '2034-02-25', 10, true, 'issued', '9012 - А0');
select is((select count(*)::int from public.supplier_act where contract_id = '50000000-0000-0000-0000-000000000012' and is_legacy), 1,
  'legacy acts may be dated on a Saturday and have no snapshot (A8)');

select * from finish();
rollback;
