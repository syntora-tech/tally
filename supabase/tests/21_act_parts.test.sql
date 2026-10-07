begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000021', 'S', 'С');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000021', 'Parts 21');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000021', 'fop', 'ФОП 21');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000021', 'fop', 'OD-9021', '10000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021');
insert into public.period (id, month, work_hours) values ('60000000-0000-0000-0000-000000000021', '2038-09-01', 176);
insert into public.payroll_item (id, period_id, person_id, payout_method, payee_id, total_usd)
  values ('70000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000021',
          '20000000-0000-0000-0000-000000000021', 'fiat', '30000000-0000-0000-0000-000000000021', 5000);

-- A-083: one payout paid in parts has an act per part, and their periods never overlap.
insert into public.supplier_act (contract_id, payee_id, payroll_item_id, act_date, period_from, period_to, amount_uah, amount_usd, fx_rate, fx_source)
  values ('50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '2038-09-16', '2038-09-01', '2038-09-16', 166000, 4000, 41.5, 'manual');
select lives_ok($$ insert into public.supplier_act (contract_id, payee_id, payroll_item_id, act_date, period_from, period_to, amount_uah)
  values ('50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '2038-09-30', '2038-09-17', '2038-09-30', 41600) $$, 'the next part starts after the previous one');
select throws_ok($$ insert into public.supplier_act (contract_id, payee_id, payroll_item_id, act_date, period_from, period_to, amount_uah)
  values ('50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '2038-09-30', '2038-09-16', '2038-09-30', 1) $$, '23P01', null, 'overlapping act periods are refused');
select lives_ok($$ insert into public.supplier_act (contract_id, payee_id, payroll_item_id, act_date, period_from, period_to, amount_uah, status, void_reason, number, is_legacy)
  values ('50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '2038-09-30', '2038-09-10', '2038-09-30', 1, 'void', 'test', '9021 - А1', true) $$, 'a void act does not count');
select throws_ok($$ insert into public.supplier_act (contract_id, payee_id, payroll_item_id, act_date, period_from, period_to, amount_uah, amount_usd)
  values ('50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '2038-09-30', '2038-10-01', '2038-10-31', 1, -1) $$, '23514', null, 'a part covers a non-negative USD amount');

-- A-085: an activity goes only into a draft act of its own payout.
insert into public.assignment (id, person_id, is_internal, starts_on)
  values ('80000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000021', true, '2038-01-01');
insert into public.payroll_line (id, payroll_item_id, assignment_id, amount, status, funding_source)
  values ('81000000-0000-0000-0000-000000000021', '70000000-0000-0000-0000-000000000021',
          '80000000-0000-0000-0000-000000000021', 5000, 'payable', 'company');
insert into public.supplier_act (id, contract_id, payee_id, act_date, amount_uah)
  values ('e0000000-0000-0000-0000-000000000021', '50000000-0000-0000-0000-000000000021', '30000000-0000-0000-0000-000000000021',
          '2038-09-30', 1);
select throws_ok($$ update public.payroll_line set supplier_act_id = 'e0000000-0000-0000-0000-000000000021'
  where id = '81000000-0000-0000-0000-000000000021' $$, 'TL065', null, 'not into an act of another payout');
select lives_ok($$ update public.payroll_line set supplier_act_id =
  (select id from public.supplier_act where payroll_item_id = '70000000-0000-0000-0000-000000000021'
     and period_from = '2038-09-17' and status = 'draft')
  where id = '81000000-0000-0000-0000-000000000021' $$, 'into a draft act of its payout');

select * from finish();
rollback;
