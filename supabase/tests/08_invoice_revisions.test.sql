begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000008', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000008', 'Client 8');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000008', 'client', 'C-8', '10000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000008', 'P8');
insert into public.assignment (id, person_id, contract_id, starts_on)
  values ('60000000-0000-0000-0000-000000000008', '20000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000008', '2032-01-01');
insert into public.period (id, month, work_hours) values ('80000000-0000-0000-0000-000000000008', '2032-03-01', 184);
insert into public.timesheet (id, assignment_id, period_id, hours)
  values ('90000000-0000-0000-0000-000000000008', '60000000-0000-0000-0000-000000000008', '80000000-0000-0000-0000-000000000008', 184);

insert into public.invoice (id, client_id, contract_id, period_id, issue_date, due_date, total)
  values ('b0000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000008', '50000000-0000-0000-0000-000000000008',
          '80000000-0000-0000-0000-000000000008', '2032-04-01', '2032-04-20', 8648);
insert into public.invoice_line (invoice_id, timesheet_id, position, description_en, description_ua, quantity, unit_price, amount)
  values ('b0000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000008', 1, 'Dev', 'Розробка', 184, 47, 8648);
update public.invoice set status = 'issued', number = 'R-1/32', snapshot = '{"v":1}', pdf_file_id = 'pdf-1'
  where id = 'b0000000-0000-0000-0000-000000000008';

-- Unpaid issued invoice: revisable with a reason, keeping its number.
select throws_ok($$ update public.invoice set total = 9000, revision = 2 where id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL006', null, 'a revision needs a reason');
select set_config('app.reason', 'client asked to split hours', true);
select throws_ok($$ update public.invoice set number = 'R-2/32', revision = 2 where id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL001', null, 'the number never changes');
select throws_ok($$ update public.invoice set client_id = gen_random_uuid(), revision = 2 where id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL001', null, 'client cannot change in a revision');
select throws_ok($$ update public.invoice set total = 9000, revision = 3 where id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL005', null, 'revisions go one by one');
select lives_ok($$ update public.invoice_line set quantity = 180, amount = 8460 where invoice_id = 'b0000000-0000-0000-0000-000000000008' $$,
  'lines are editable during a revision');
select lives_ok($$ update public.invoice set total = 8460, snapshot = '{"v":2}', pdf_file_id = null, revision = 2
  where id = 'b0000000-0000-0000-0000-000000000008' $$, 'revision keeps the number and clears the old PDF');
select is((select number || ' r' || revision from public.invoice where id = 'b0000000-0000-0000-0000-000000000008'), 'R-1/32 r2', 'number kept, revision bumped');
select is((select total::text || '|' || (snapshot ->> 'v') || '|' || pdf_file_id || '|' || reason from public.invoice_revision
           where invoice_id = 'b0000000-0000-0000-0000-000000000008' and revision = 1),
  '8648.00000000|1|pdf-1|client asked to split hours', 'previous state and reason are kept');
select set_config('app.reason', '', true);
select throws_ok($$ update public.invoice_line set quantity = 1 where invoice_id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL001', null, 'lines are frozen outside a revision');

-- Any payment freezes the invoice.
insert into public.account (id, name, kind, currency, opening_date)
  values ('a8000000-0000-0000-0000-000000000001', 'T8 USD', 'bank', 'USD', '2032-01-01');
insert into public.transaction (id, occurred_on, type, category_id)
  select 'c8000000-0000-0000-0000-000000000001', '2032-04-10', 'revenue', id from public.category
   where tx_type = 'revenue' and name = 'Client Revenue';
insert into public.posting (transaction_id, account_id, amount, currency)
  values ('c8000000-0000-0000-0000-000000000001', 'a8000000-0000-0000-0000-000000000001', 1000, 'USD');
insert into public.allocation (transaction_id, amount, currency, invoice_id)
  values ('c8000000-0000-0000-0000-000000000001', 1000, 'USD', 'b0000000-0000-0000-0000-000000000008');
select set_config('app.reason', 'try after payment', true);
select throws_ok($$ update public.invoice set total = 1, revision = 3 where id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL001', null, 'paid invoices cannot be revised');
select set_config('app.reason', '', true);

-- Void + reissue: void lines may release their timesheet only.
update public.invoice set status = 'void', void_reason = 'wrong client' where id = 'b0000000-0000-0000-0000-000000000008';
select lives_ok($$ update public.invoice_line set timesheet_id = null where invoice_id = 'b0000000-0000-0000-0000-000000000008' $$,
  'void lines release their timesheet');
select throws_ok($$ update public.invoice_line set amount = 1 where invoice_id = 'b0000000-0000-0000-0000-000000000008' $$,
  'TL001', null, 'void lines stay frozen otherwise');

select * from finish();
rollback;
