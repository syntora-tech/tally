begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c1', 'viewer11@t.local');
insert into public.app_user (id, email, role) values ('00000000-0000-0000-0000-0000000000c1', 'viewer11@t.local', 'viewer');

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000011', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000011', 'Client 11');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000011', 'client', 'C-11', '10000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000011', 'P11');
insert into public.assignment (id, person_id, contract_id, starts_on)
  values ('60000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011', '2034-01-01');
insert into public.period (id, month, work_hours) values ('80000000-0000-0000-0000-000000000011', '2034-08-01', 168);
insert into public.timesheet (id, assignment_id, period_id, hours)
  values ('90000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', 168);

insert into public.invoice (id, client_id, contract_id, period_id, issue_date, due_date, total)
  values ('b0000000-0000-0000-0000-000000000011', '40000000-0000-0000-0000-000000000011', '50000000-0000-0000-0000-000000000011',
          '80000000-0000-0000-0000-000000000011', '2034-09-01', '2034-09-20', 1000);
insert into public.invoice_line (id, invoice_id, timesheet_id, position, description_en, description_ua, quantity, unit_price, amount)
  values ('b1000000-0000-0000-0000-000000000011', 'b0000000-0000-0000-0000-000000000011', '90000000-0000-0000-0000-000000000011',
          1, 'Dev', 'Розробка', 1, 1000, 1000);
update public.invoice set status = 'issued', number = 'P-11/34', snapshot = '{}' where id = 'b0000000-0000-0000-0000-000000000011';

-- I6 for adjustments: allowed while open.
select lives_ok($$ insert into public.adjustment (period_id, person_id, kind, amount, currency, reason)
  values ('80000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'bonus', 3325, 'UAH', 'July bonus') $$,
  'adjustments can be added while the period is open');
select throws_ok($$ insert into public.adjustment (period_id, person_id, kind, amount, currency, reason)
  values ('80000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'bonus', 1, 'UAH', ' ') $$,
  '23514', null, 'an adjustment needs a reason');

insert into public.payroll_item (id, period_id, person_id, payout_method, total_usd)
  values ('c0000000-0000-0000-0000-000000000011', '80000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'fiat', 800);
insert into public.payroll_line (id, payroll_item_id, assignment_id, timesheet_id, amount, funded_by_invoice_line_id, status)
  values ('c1000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000011',
          '90000000-0000-0000-0000-000000000011', 800, 'b1000000-0000-0000-0000-000000000011', 'awaiting_client');
update public.period set status = 'closed' where id = '80000000-0000-0000-0000-000000000011';

select throws_ok($$ insert into public.adjustment (period_id, person_id, kind, amount, currency, reason)
  values ('80000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000011', 'bonus', 1, 'UAH', 'late') $$,
  'TL030', null, 'I6: no adjustments in a closed period');
select throws_ok($$ update public.payroll_line set amount = 900 where id = 'c1000000-0000-0000-0000-000000000011' $$,
  'TL030', null, 'I6: accrued amounts are frozen');
select throws_ok($$ update public.payroll_line set status = 'payable' where id = 'c1000000-0000-0000-0000-000000000011' $$,
  '23514', null, 'a payable line needs a funding source');

-- Client pays in full → the funded line becomes payable at the client's expense (5.3).
insert into public.account (id, name, kind, currency, opening_date) values
  ('a1100000-0000-0000-0000-000000000001', 'T11 USD', 'bank', 'USD', '2034-01-01'),
  ('a1100000-0000-0000-0000-000000000002', 'T11 UAH', 'bank', 'UAH', '2034-01-01');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'd1100000-0000-0000-0000-000000000001', '2034-09-17', 'revenue', id from public.category where tx_type = 'revenue' and name = 'Client Revenue';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('d1100000-0000-0000-0000-000000000001', 'a1100000-0000-0000-0000-000000000001', 1000, 'USD');
insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('d1100000-0000-0000-0000-000000000001', 600, 'USD', 'b0000000-0000-0000-0000-000000000011');
select is((select status::text from public.payroll_line where id = 'c1000000-0000-0000-0000-000000000011'),
  'awaiting_client', 'partial payment does not release the line');
insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('d1100000-0000-0000-0000-000000000001', 400, 'USD', 'b0000000-0000-0000-0000-000000000011');
select is((select status::text || ' ' || funding_source::text from public.payroll_line where id = 'c1000000-0000-0000-0000-000000000011'),
  'payable client', 'full payment releases the line, funded by the client');
select is((select status::text from public.payroll_item where id = 'c0000000-0000-0000-0000-000000000011'), 'payable', 'item becomes payable');

-- Payout: expense in UAH, needs the item's rate first.
insert into public.transaction (id, occurred_on, type, category_id)
  select 'd1100000-0000-0000-0000-000000000002', '2034-09-22', 'expense', id from public.category where tx_type = 'expense' and name = 'Contractors';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('d1100000-0000-0000-0000-000000000002', 'a1100000-0000-0000-0000-000000000002', -38909, 'UAH');
select throws_ok($$ insert into public.allocation (transaction_id, amount, currency, payroll_item_id)
  values ('d1100000-0000-0000-0000-000000000002', 38909, 'UAH', 'c0000000-0000-0000-0000-000000000011') $$,
  'TL056', null, 'a fiat payout needs the payout rate first');
update public.payroll_item set payout_fx_rate = 44.48, fx_source = 'manual', total_uah = 38909
 where id = 'c0000000-0000-0000-0000-000000000011';
insert into public.allocation (transaction_id, amount, currency, payroll_item_id)
  values ('d1100000-0000-0000-0000-000000000002', 38909, 'UAH', 'c0000000-0000-0000-0000-000000000011');
select is((select i.status::text || ' ' || l.status::text from public.payroll_item i join public.payroll_line l on l.payroll_item_id = i.id
           where i.id = 'c0000000-0000-0000-0000-000000000011'), 'paid paid', 'a full payout marks item and lines paid');

-- Reopening a period with payouts is refused.
select set_config('app.actor', 'system:test', true), set_config('app.reason', 'test', true);
select throws_ok($$ update public.period set status = 'open' where id = '80000000-0000-0000-0000-000000000011' $$,
  'TL032', null, 'a period with payouts cannot be reopened');
select set_config('app.actor', '', true), set_config('app.reason', '', true);

-- RLS: viewers do not see payroll.
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.payroll_item), 0, 'viewer reads no payroll items');
select is((select count(*)::int from public.adjustment), 0, 'viewer reads no adjustments');
reset role;

select * from finish();
rollback;
