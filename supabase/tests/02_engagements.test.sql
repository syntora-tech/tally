begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a2', 'owner2@t.local'),
  ('00000000-0000-0000-0000-0000000000c2', 'viewer2@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000a2', 'owner2@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000c2', 'viewer2@t.local', 'viewer');

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

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000002', 'SYNTORA', 'СІНТОРА');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000002', 'IdeaSoft');
insert into public.payee (id, kind, legal_name_ua) values ('30000000-0000-0000-0000-000000000002', 'fop', 'ФОП Щурко');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000002', 'Andrii');

-- I9: contract has exactly one counterparty matching its kind.
select lives_ok($$ insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000002', 'client', 'Annex 3', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002') $$,
  'client contract with a client');
select lives_ok($$ insert into public.contract (kind, number, company_id, payee_id)
  values ('fop', 'OD-1001', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002') $$,
  'fop contract with a payee');
select throws_ok($$ insert into public.contract (kind, number, company_id, client_id, payee_id)
  values ('client', 'X', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'I9: both counterparties rejected');
select throws_ok($$ insert into public.contract (kind, number, company_id)
  values ('client', 'X', '10000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'I9: no counterparty rejected');
select throws_ok($$ insert into public.contract (kind, number, company_id, payee_id)
  values ('client', 'X', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002') $$,
  '23514', null, 'I9: client contract pointing at a payee rejected');
select throws_ok($$ insert into public.contract (kind, number, company_id, client_id, act_date_rule)
  values ('client', 'X', '10000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '{"type":"whenever"}') $$,
  '23514', null, 'unknown date rule type rejected');
select is((select payment_due_rule ->> 'day' from public.contract where number = 'Annex 3'), '20',
  'payment due rule defaults to the 20th (spec 5.5)');

-- assignment checks.
select throws_ok($$ insert into public.assignment (person_id, starts_on) values ('20000000-0000-0000-0000-000000000002', '2026-01-01') $$,
  '23514', null, 'non-internal assignment needs a contract');
select lives_ok($$ insert into public.assignment (person_id, is_internal, role_title, fte, starts_on)
  values ('20000000-0000-0000-0000-000000000002', true, 'CTO', 1, '2026-01-01') $$,
  'internal assignment without contract');
select throws_ok($$ insert into public.assignment (person_id, contract_id, fte, starts_on)
  values ('20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 1.5, '2026-01-01') $$,
  '23514', null, 'fte above 1 rejected');
select throws_ok($$ insert into public.assignment (person_id, contract_id, starts_on, ends_on)
  values ('20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '2026-05-01', '2026-04-30') $$,
  '23514', null, 'ends_on before starts_on rejected');
insert into public.assignment (id, person_id, contract_id, starts_on)
  values ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', '2026-01-01');

-- Terms versions.
select lives_ok($$ insert into public.billing_terms (assignment_id, valid_from, type, rate)
  values ('60000000-0000-0000-0000-000000000002', '2026-01-01', 'hourly', 45) $$, 'first billing version');
select throws_ok($$ insert into public.billing_terms (assignment_id, valid_from, type, rate)
  values ('60000000-0000-0000-0000-000000000002', '2026-01-01', 'hourly', 50) $$,
  '23505', null, 'one version per valid_from');
select throws_ok($$ insert into public.billing_terms (assignment_id, valid_from, type, rate)
  values ('60000000-0000-0000-0000-000000000002', '2026-03-15', 'hourly', 50) $$,
  '23514', null, 'versions start on the first day of a month');
select lives_ok($$ insert into public.pay_terms (assignment_id, valid_from, type, amount)
  values ('60000000-0000-0000-0000-000000000002', '2026-01-01', 'fixed', 3000) $$, 'first pay version');
select is((select release_policy::text || '/' || grace_days from public.pay_terms), 'on_payment_or_due/0',
  'pay terms default to pay-when-paid without grace days');

-- I10: close July 2026.
insert into public.period (month, work_hours, status) values
  ('2026-06-01', 176, 'closed'), ('2026-07-01', 184, 'closed'), ('2026-08-01', 168, 'open');
select is(public.last_closed_period_end(), '2026-07-31'::date, 'last closed period ends on 31.07');
select throws_ok($$ insert into public.billing_terms (assignment_id, valid_from, type, rate)
  values ('60000000-0000-0000-0000-000000000002', '2026-07-01', 'hourly', 47) $$,
  'TL010', 'terms_in_closed_period', 'I10: new version inside a closed period rejected');
select throws_ok($$ update public.billing_terms set rate = 99 where valid_from = '2026-01-01' $$,
  'TL010', 'terms_in_closed_period', 'I10: editing a version that started in a closed period rejected');
select throws_ok($$ delete from public.pay_terms where valid_from = '2026-01-01' $$,
  'TL010', 'terms_in_closed_period', 'I10: deleting a closed version rejected');
select lives_ok($$ insert into public.billing_terms (assignment_id, valid_from, type, rate)
  values ('60000000-0000-0000-0000-000000000002', '2026-08-01', 'hourly', 47) $$,
  'I10: version from the first open month allowed');
select throws_ok($$ update public.billing_terms set valid_from = '2026-07-01' where valid_from = '2026-08-01' $$,
  'TL010', 'terms_in_closed_period', 'I10: moving a version into a closed period rejected');
select lives_ok($$ update public.billing_terms set rate = 48 where valid_from = '2026-08-01' $$,
  'I10: open-period version is editable');
select throws_ok($$ insert into public.period (month, work_hours) values ('2026-09-15', 176) $$,
  '23514', null, 'period month is the first day');

-- RLS: viewer sees none of the engagement tables.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select is((select count(*)::int from public.contract) + (select count(*)::int from public.assignment)
  + (select count(*)::int from public.billing_terms) + (select count(*)::int from public.pay_terms)
  + (select count(*)::int from public.period), 0, 'viewer sees no contracts, assignments, terms or periods');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.billing_terms), 2, 'owner sees billing terms');
select pg_temp.reset_actor();

select * from finish();
rollback;
