begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000022', 'S', 'С');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000022', 'fop', 'ФОП 22');
insert into public.person (id, full_name, default_payee_id)
  values ('20000000-0000-0000-0000-000000000022', 'Month 22', '30000000-0000-0000-0000-000000000022');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000022', 'fop', 'OD-9022', '10000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000022');
insert into public.period (id, month, work_hours) values ('60000000-0000-0000-0000-000000000022', '2039-09-01', 176);
insert into public.assignment (id, person_id, is_internal, starts_on)
  values ('80000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000022', true, '2039-01-01');

-- A-089: acts of a month made before the close never overlap, and a piece of work goes into one.
insert into public.supplier_act (id, contract_id, payee_id, act_date, period_from, period_to, amount_uah, amount_usd, assignment_ids)
  values ('90000000-0000-0000-0000-000000000022', '50000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000022',
          '2039-09-16', '2039-09-01', '2039-09-16', 0, 4000, array['80000000-0000-0000-0000-000000000022'::uuid]);
select throws_ok($$ insert into public.supplier_act (contract_id, payee_id, act_date, period_from, period_to, amount_uah)
  values ('50000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000022', '2039-09-30', '2039-09-16', '2039-09-30', 0) $$,
  'TL066', null, 'early acts of a month do not overlap');
select lives_ok($$ insert into public.supplier_act (id, contract_id, payee_id, act_date, period_from, period_to, amount_uah)
  values ('91000000-0000-0000-0000-000000000022', '50000000-0000-0000-0000-000000000022', '30000000-0000-0000-0000-000000000022',
          '2039-09-30', '2039-09-17', '2039-09-30', 0) $$, 'the next act starts after the previous one');
select throws_ok($$ update public.supplier_act set amount_usd = 0, assignment_ids = array['80000000-0000-0000-0000-000000000022'::uuid]
  where id = '91000000-0000-0000-0000-000000000022' $$, 'TL066', null, 'a piece of work goes into one act of the month');

insert into public.adjustment (id, period_id, person_id, kind, amount, currency, reason)
  values ('a0000000-0000-0000-0000-000000000022', '60000000-0000-0000-0000-000000000022',
          '20000000-0000-0000-0000-000000000022', 'bonus', 100, 'USD', 'Test');
select lives_ok($$ update public.adjustment set supplier_act_id = '90000000-0000-0000-0000-000000000022'
  where id = 'a0000000-0000-0000-0000-000000000022' $$, 'before the close an adjustment goes into an act of the person''s month');

insert into public.payee (id, kind, legal_name_ua) values ('31000000-0000-0000-0000-000000000022', 'fop', 'ФОП 22b');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('51000000-0000-0000-0000-000000000022', 'fop', 'OD-9122', '10000000-0000-0000-0000-000000000022', '31000000-0000-0000-0000-000000000022');
insert into public.supplier_act (id, contract_id, payee_id, act_date, period_from, period_to, amount_uah)
  values ('92000000-0000-0000-0000-000000000022', '51000000-0000-0000-0000-000000000022', '31000000-0000-0000-0000-000000000022',
          '2039-09-30', '2039-09-01', '2039-09-30', 0);
select throws_ok($$ update public.adjustment set supplier_act_id = '92000000-0000-0000-0000-000000000022'
  where id = 'a0000000-0000-0000-0000-000000000022' $$, 'TL065', null, 'not into an act of someone else');

update public.supplier_act set status = 'issued', number = '9022 - А1', snapshot = '{}', act_date = '2039-09-16'
  where id = '90000000-0000-0000-0000-000000000022';
select throws_ok($$ update public.supplier_act set assignment_ids = null where id = '90000000-0000-0000-0000-000000000022' $$,
  'TL001', null, 'the work of an issued act is frozen');

select * from finish();
rollback;
