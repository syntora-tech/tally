begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(9);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000018', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000018', 'Client 18');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000018', 'client', 'C-18', '10000000-0000-0000-0000-000000000018', '40000000-0000-0000-0000-000000000018');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000018', 'P18');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000018', 'fop', 'ФОП Агенція 18');
insert into public.assignment (id, person_id, contract_id, starts_on)
  values ('60000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000018', '50000000-0000-0000-0000-000000000018', '2035-01-01');
insert into public.period (id, month, work_hours) values ('80000000-0000-0000-0000-000000000018', '2035-03-01', 168);
insert into public.timesheet (id, assignment_id, period_id, hours)
  values ('90000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000018', '80000000-0000-0000-0000-000000000018', 160);

select lives_ok($$ insert into public.agency_terms (assignment_id, valid_from, payee_id, rate_per_hour)
  values ('60000000-0000-0000-0000-000000000018', '2035-01-01', '30000000-0000-0000-0000-000000000018', 4) $$,
  'an agency fee per hour of the person');
select throws_ok($$ insert into public.agency_terms (assignment_id, valid_from, payee_id, rate_per_hour, currency)
  values ('60000000-0000-0000-0000-000000000018', '2035-02-01', '30000000-0000-0000-0000-000000000018', 4, 'EUR') $$,
  '23514', null, 'agency fees accrue in USD');

-- Items: a person item has a person, an agency item has a payee and no person.
insert into public.payroll_item (id, period_id, person_id, payout_method, total_usd)
  values ('c0000000-0000-0000-0000-000000000018', '80000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000018', 'fiat', 1000);
select lives_ok($$ insert into public.payroll_item (id, kind, period_id, payee_id, payout_method, total_usd)
  values ('c2000000-0000-0000-0000-000000000018', 'agency', '80000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000018', 'fiat', 640) $$,
  'an agency item next to the person item');
select throws_ok($$ insert into public.payroll_item (kind, period_id, person_id, payee_id, payout_method)
  values ('agency', '80000000-0000-0000-0000-000000000018', '20000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000018', 'fiat') $$,
  '23514', null, 'an agency item has no person');
select throws_ok($$ insert into public.payroll_item (kind, period_id, payee_id, payout_method)
  values ('agency', '80000000-0000-0000-0000-000000000018', '30000000-0000-0000-0000-000000000018', 'fiat') $$,
  '23505', null, 'one agency item per payee, period and method');

-- Lines: the same timesheet gives one pay line and one agency fee line, each in its kind of item.
select lives_ok($$ insert into public.payroll_line (payroll_item_id, assignment_id, timesheet_id, amount_usd) values
  ('c0000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000018', '90000000-0000-0000-0000-000000000018', 1000) $$,
  'the person line');
select lives_ok($$ insert into public.payroll_line (payroll_item_id, assignment_id, timesheet_id, amount_usd, agency_fee) values
  ('c2000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000018', '90000000-0000-0000-0000-000000000018', 640, true) $$,
  'the agency fee line of the same timesheet');
select throws_ok($$ insert into public.payroll_line (payroll_item_id, assignment_id, amount_usd, agency_fee) values
  ('c0000000-0000-0000-0000-000000000018', '60000000-0000-0000-0000-000000000018', 1, true) $$,
  'TL057', null, 'an agency fee line cannot sit in a person item');

-- I10: no back-dated agency terms into a closed period.
update public.period set status = 'closed' where id = '80000000-0000-0000-0000-000000000018';
select throws_ok($$ insert into public.agency_terms (assignment_id, valid_from, payee_id, rate_per_hour)
  values ('60000000-0000-0000-0000-000000000018', '2035-03-01', '30000000-0000-0000-0000-000000000018', 5) $$,
  'TL010', null, 'agency terms respect closed periods');

select * from finish();
rollback;
