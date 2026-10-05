begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017b1', 'finance17@t.local'),
  ('00000000-0000-0000-0000-0000000017c1', 'viewer17@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000017b1', 'finance17@t.local', 'finance'),
  ('00000000-0000-0000-0000-0000000017c1', 'viewer17@t.local', 'viewer');

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

create temp table cats on commit drop as
  select (select id from public.category where tx_type = 'expense' and name = 'Legal / Accounting') as expense,
         (select id from public.category where tx_type = 'revenue' and name = 'Client Revenue') as revenue;
grant select on cats to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000017b1');
select lives_ok($$ insert into public.planned_expense (name, category_id, amount, currency, due_day, starts_on)
  select 'Accountant', expense, 12000, 'UAH', 10, '2026-09-01' from cats $$, 'finance plans a monthly expense');
select lives_ok($$ insert into public.planned_expense (name, category_id, amount, currency, frequency, anchor_month, starts_on)
  select 'Domain', expense, 40, 'USD', 'yearly', 3, '2026-01-01' from cats $$, 'a yearly expense has an anchor month');
select throws_ok($$ insert into public.planned_expense (name, category_id, amount, currency, frequency, starts_on)
  select 'No month', expense, 40, 'USD', 'yearly', '2026-01-01' from cats $$, '23514', null, 'yearly needs an anchor month');
select throws_ok($$ insert into public.planned_expense (name, category_id, amount, currency, starts_on)
  select 'Wrong type', revenue, 40, 'USD', '2026-01-01' from cats $$, '23503', null, 'only expense categories');
select throws_ok($$ insert into public.planned_expense (name, category_id, amount, currency, starts_on, ends_on)
  select 'Backwards', expense, 40, 'USD', '2026-05-01', '2026-04-01' from cats $$, '23514', null, 'ends after it starts');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000017c1');
select is((select count(*)::int from public.planned_expense where name in ('Accountant', 'Domain')), 0, 'viewers see no plans');
select pg_temp.reset_actor();

select ok(exists (select 1 from public.audit_log where table_name = 'planned_expense' and row_id in
  (select id from public.planned_expense where name = 'Accountant')), 'changes are audited');

select * from finish();
rollback;
