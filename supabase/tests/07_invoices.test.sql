begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

create temp table audit_start on commit drop as select coalesce(max(id), 0) as id from public.audit_log;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'owner7@t.local'),
  ('00000000-0000-0000-0000-0000000000b7', 'finance7@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000a7', 'owner7@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000b7', 'finance7@t.local', 'finance');

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

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000007', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000007', 'Client 7');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000007', 'client', 'C-7', '10000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000007', 'P7');
insert into public.assignment (id, person_id, contract_id, starts_on)
  values ('60000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000007', '2031-01-01');
insert into public.period (id, month, work_hours) values ('80000000-0000-0000-0000-000000000007', '2031-03-01', 168);
insert into public.timesheet (id, assignment_id, period_id, hours)
  values ('90000000-0000-0000-0000-000000000007', '60000000-0000-0000-0000-000000000007', '80000000-0000-0000-0000-000000000007', 168);

-- Draft: freely editable.
insert into public.invoice (id, client_id, contract_id, period_id, issue_date, due_date, total)
  values ('a0000000-0000-0000-0000-000000000007', '40000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000007',
          '80000000-0000-0000-0000-000000000007', '2031-04-01', '2031-04-20', 7896);
select lives_ok($$ insert into public.invoice_line (invoice_id, timesheet_id, position, description_en, description_ua, quantity, unit_price, amount)
  values ('a0000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000007', 1, 'Dev', 'Розробка', 168, 47, 7896) $$,
  'draft lines can be added');
select lives_ok($$ update public.invoice set total = 7896 where id = 'a0000000-0000-0000-0000-000000000007' $$, 'draft is editable');
select throws_ok($$ update public.invoice set number = '1/31' where id = 'a0000000-0000-0000-0000-000000000007' $$,
  '23514', null, 'drafts carry no number (D10)');

-- I3: issuing on a Saturday needs an owner override with a reason.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select throws_ok($$ update public.invoice set status = 'issued', number = '1/31', snapshot = '{}', issue_date = '2031-04-05'
  where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL004', 'document_date_not_working_day', 'I3: Saturday rejected');
select throws_ok($$ update public.invoice set status = 'issued', number = '1/31', snapshot = '{}', issue_date = '2031-04-05', date_override_reason = 'client asked'
  where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL004', null, 'I3: finance cannot override');
select pg_temp.reset_actor();
select throws_ok($$ update public.invoice set status = 'issued', number = '1/31' where id = 'a0000000-0000-0000-0000-000000000007' $$,
  'TL003', 'invoice_snapshot_required', 'snapshot is required to issue');
select lives_ok($$ update public.invoice set status = 'issued', number = '1/31', snapshot = '{"doc":{}}' where id = 'a0000000-0000-0000-0000-000000000007' $$,
  'issue on a working day');

-- I1: frozen after issue.
select throws_ok($$ update public.invoice set total = 1 where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL005', null, 'I1: total changes only through a revision');
select throws_ok($$ update public.invoice set issue_date = '2031-04-02' where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL005', null, 'I1: date changes only through a revision');
select throws_ok($$ update public.invoice_line set amount = 1 $$, 'TL001', null, 'I1: lines frozen');
select throws_ok($$ delete from public.invoice where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL001', null, 'I1: cannot delete');
select lives_ok($$ update public.invoice set pdf_file_id = 'drive-1' where id = 'a0000000-0000-0000-0000-000000000007' $$, 'generated file id set once');
select throws_ok($$ update public.invoice set pdf_file_id = 'drive-2' where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL001', null, 'file id cannot be replaced');
select throws_ok($$ update public.invoice set status = 'paid', paid_amount = 7896 where id = 'a0000000-0000-0000-0000-000000000007' $$,
  'TL055', null, 'I7: paid_amount comes only from allocations');
select throws_ok($$ update public.invoice set status = 'paid' where id = 'a0000000-0000-0000-0000-000000000007' $$, 'TL002', null, 'payment status follows paid_amount');

-- I2: one issued number per invoice.
insert into public.invoice (id, client_id, contract_id, issue_date, due_date)
  values ('a0000000-0000-0000-0000-000000000008', '40000000-0000-0000-0000-000000000007', '50000000-0000-0000-0000-000000000007', '2031-04-01', '2031-04-20');
select throws_ok($$ update public.invoice set status = 'issued', number = '1/31', snapshot = '{}' where id = 'a0000000-0000-0000-0000-000000000008' $$,
  '23505', null, 'I2: issued numbers are unique');
update public.invoice set status = 'issued', number = '2/31', snapshot = '{}' where id = 'a0000000-0000-0000-0000-000000000008';
select throws_ok($$ update public.invoice set status = 'void' where id = 'a0000000-0000-0000-0000-000000000008' $$,
  '23514', null, 'void needs a reason');

-- I6: closed period is read-only; reopening is owner-only with a reason in audit.
update public.period set status = 'closed' where id = '80000000-0000-0000-0000-000000000007';
select throws_ok($$ update public.timesheet set hours = 100 where id = '90000000-0000-0000-0000-000000000007' $$, 'TL030', null, 'I6: hours of a closed period are frozen');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b7');
select throws_ok($$ update public.period set status = 'open' where id = '80000000-0000-0000-0000-000000000007' $$, '42501', null, 'finance cannot reopen');
select pg_temp.reset_actor();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a7');
select set_config('app.reason', 'client disputed hours', true);
update public.period set status = 'open' where id = '80000000-0000-0000-0000-000000000007';
select pg_temp.reset_actor();
select is((select reason from public.audit_log where table_name = 'period' and id > (select id from audit_start) order by id desc limit 1),
  'client disputed hours', 'reopen reason is audited');

select * from finish();
rollback;
