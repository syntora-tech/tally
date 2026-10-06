begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000020', 'Director 20');
insert into public.planned_expense (id, name, category_id, amount, currency, starts_on, person_id)
  select 'c0000000-0000-0000-0000-000000000020', 'Salary 20', id, 11000, 'UAH', '2037-01-01', '20000000-0000-0000-0000-000000000020'
    from public.category where tx_type = 'expense' and name = 'Payroll';

select throws_ok($$ insert into public.planned_expense_part (planned_expense_id, name, due_day) values
  ('c0000000-0000-0000-0000-000000000020', 'Rest A', 7), ('c0000000-0000-0000-0000-000000000020', 'Rest B', 8) $$,
  '23505', null, 'one rest part per expense');
select throws_ok($$ insert into public.payment_charge (name, person_id, mode, rate_percent, category_id, starts_on)
  select 'PIT', '20000000-0000-0000-0000-000000000020', 'withheld', 18, id, '2037-01-01'
    from public.category where tx_type = 'expense' and name = 'Taxes' $$,
  '23514', null, 'a payout charge cannot be withheld');
select throws_ok($$ insert into public.payment_charge (name, planned_expense_id, mode, rate_percent, category_id, starts_on)
  select 'Bad', 'c0000000-0000-0000-0000-000000000020', 'on_top', 101, id, '2037-01-01'
    from public.category where tx_type = 'expense' and name = 'Taxes' $$,
  '23514', null, 'a rate is at most 100 %');
select throws_ok($$ update public.planned_expense set fee_fixed = -1 where id = 'c0000000-0000-0000-0000-000000000020' $$,
  '23514', null, 'a fee is not negative');

insert into public.planned_payment (id, planned_expense_id, month, due_on, name, category_id, amount, currency)
  select 'c1000000-0000-0000-0000-000000000020', 'c0000000-0000-0000-0000-000000000020', '2037-01-01', '2037-01-22',
         'Salary 20', id, 4235, 'UAH' from public.category where tx_type = 'expense' and name = 'Payroll';
select throws_ok($$ insert into public.planned_payment (planned_expense_id, month, due_on, name, category_id, amount, currency)
  select 'c0000000-0000-0000-0000-000000000020', '2037-01-01', '2037-01-22', 'Twice', id, 1, 'UAH'
    from public.category where tx_type = 'expense' and name = 'Payroll' $$,
  '23505', null, 'one payment per expense, part, charge and month');
select throws_ok($$ insert into public.planned_payment (planned_expense_id, month, due_on, name, category_id, amount, currency, status)
  select 'c0000000-0000-0000-0000-000000000020', '2037-02-01', '2037-02-22', 'Paid by hand', id, 1, 'UAH', 'paid'
    from public.category where tx_type = 'expense' and name = 'Payroll' $$,
  'TL064', null, 'paid is never set by hand');
select throws_ok($$ update public.planned_payment set status = 'skipped' where id = 'c1000000-0000-0000-0000-000000000020' $$,
  '23514', null, 'skipping needs a reason');

insert into public.account (id, name, kind, currency, opening_date) values
  ('a1000000-0000-0000-0000-000000000020', 'UAH 20', 'bank', 'UAH', '2037-01-01'),
  ('a3000000-0000-0000-0000-000000000020', 'USD 20', 'bank', 'USD', '2037-01-01');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'a2000000-0000-0000-0000-000000000020', '2037-01-22', 'expense', id from public.category where tx_type = 'expense' and name = 'Payroll';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('a2000000-0000-0000-0000-000000000020', 'a1000000-0000-0000-0000-000000000020', -4300, 'UAH');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'a4000000-0000-0000-0000-000000000020', '2037-01-22', 'expense', id from public.category where tx_type = 'expense' and name = 'Payroll';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('a4000000-0000-0000-0000-000000000020', 'a3000000-0000-0000-0000-000000000020', -100, 'USD');

select throws_ok($$ insert into public.allocation (transaction_id, planned_payment_id, amount, currency)
  values ('a4000000-0000-0000-0000-000000000020', 'c1000000-0000-0000-0000-000000000020', 100, 'USD') $$,
  'TL051', null, 'paid in its own currency');
select lives_ok($$ insert into public.allocation (id, transaction_id, planned_payment_id, amount, currency)
  values ('a5000000-0000-0000-0000-000000000020', 'a2000000-0000-0000-0000-000000000020', 'c1000000-0000-0000-0000-000000000020', 4300, 'UAH') $$,
  'the actual amount may differ from the plan');
select is((select status::text from public.planned_payment where id = 'c1000000-0000-0000-0000-000000000020'), 'paid',
  'a linked expense makes it paid');
select throws_ok($$ update public.planned_payment set amount = 1 where id = 'c1000000-0000-0000-0000-000000000020' $$,
  'TL064', null, 'a paid payment keeps its amount');
select throws_ok($$ delete from public.planned_payment where id = 'c1000000-0000-0000-0000-000000000020' $$,
  'TL064', null, 'a paid payment is not deleted');

delete from public.allocation where id = 'a5000000-0000-0000-0000-000000000020';
select is((select status::text from public.planned_payment where id = 'c1000000-0000-0000-0000-000000000020'), 'due',
  'unlinking makes it due again');
select lives_ok($$ update public.planned_payment set status = 'skipped', skip_reason = 'Sick leave'
  where id = 'c1000000-0000-0000-0000-000000000020' $$, 'a due payment is skipped with a reason');

select * from finish();
rollback;
