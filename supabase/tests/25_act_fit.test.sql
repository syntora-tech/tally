begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000025', 'F', 'Ф');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000025', 'Fit 25');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000025', 'fop', 'ФОП 25');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000025', 'fop', 'OD-9025', '10000000-0000-0000-0000-000000000025', '30000000-0000-0000-0000-000000000025');
insert into public.period (id, month, work_hours) values ('60000000-0000-0000-0000-000000000025', '2039-10-01', 176);
insert into public.payroll_item (id, period_id, person_id, payout_method, payee_id, total_usd)
  values ('70000000-0000-0000-0000-000000000025', '60000000-0000-0000-0000-000000000025',
          '20000000-0000-0000-0000-000000000025', 'fiat', '30000000-0000-0000-0000-000000000025', 5000);
insert into public.assignment (id, person_id, is_internal, starts_on)
  values ('80000000-0000-0000-0000-000000000025', '20000000-0000-0000-0000-000000000025', true, '2039-01-01');
insert into public.payroll_line (id, payroll_item_id, assignment_id, amount, status, funding_source)
  values ('81000000-0000-0000-0000-000000000025', '70000000-0000-0000-0000-000000000025',
          '80000000-0000-0000-0000-000000000025', 1000, 'payable', 'company');
-- An act issued before the close, linked to the payout at the close as the act of the rest.
insert into public.supplier_act (id, contract_id, payee_id, payroll_item_id, act_date, period_from, period_to,
                                 amount_uah, fx_rate, fx_source, status, number, snapshot)
  values ('e0000000-0000-0000-0000-000000000025', '50000000-0000-0000-0000-000000000025', '30000000-0000-0000-0000-000000000025',
          '70000000-0000-0000-0000-000000000025', '2039-10-31', '2039-10-20', '2039-10-31',
          42000, 42, 'manual', 'issued', '9025 - А1', '{"version": 1}');

-- A-139: only the fitting service may give it its work, once, and never change its money.
select throws_ok($$ update public.supplier_act set amount_usd = 1000
  where id = 'e0000000-0000-0000-0000-000000000025' $$, 'TL001', null, 'an issued act keeps its USD share');
select throws_ok($$ update public.payroll_line set supplier_act_id = 'e0000000-0000-0000-0000-000000000025'
  where id = '81000000-0000-0000-0000-000000000025' $$, 'TL065', null, 'work does not go into an issued act');

select set_config('app.act_fit', 'on', true);
select throws_ok($$ update public.supplier_act set amount_usd = 1000, amount_uah = 41000
  where id = 'e0000000-0000-0000-0000-000000000025' $$, 'TL001', null, 'fitting never changes the signed amount');
select lives_ok($$ update public.supplier_act set amount_usd = 1000, assignment_ids = array['80000000-0000-0000-0000-000000000025']::uuid[]
  where id = 'e0000000-0000-0000-0000-000000000025' $$, 'the fitting service sets its work and USD share');
select lives_ok($$ update public.payroll_line set supplier_act_id = 'e0000000-0000-0000-0000-000000000025'
  where id = '81000000-0000-0000-0000-000000000025' $$, 'and moves that work into it');
select throws_ok($$ update public.supplier_act set amount_usd = 900
  where id = 'e0000000-0000-0000-0000-000000000025' $$, 'TL001', null, 'only once');
select throws_ok($$ update public.payroll_line set supplier_act_id = null
  where id = '81000000-0000-0000-0000-000000000025' $$, 'TL065', null, 'work never leaves an issued act');

select * from finish();
rollback;
