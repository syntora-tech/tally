begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c5', 'viewer5@t.local');
insert into public.app_user (id, email, role) values ('00000000-0000-0000-0000-0000000000c5', 'viewer5@t.local', 'viewer');
insert into public.person (id, full_name) values ('20000000-0000-0000-0000-000000000005', 'Timesheet person');
insert into public.assignment (id, person_id, is_internal, starts_on)
  values ('60000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', true, '2026-08-01');
insert into public.period (id, month, work_hours) values ('80000000-0000-0000-0000-000000000005', '2031-08-01', 160);

select lives_ok($$ insert into public.timesheet (assignment_id, period_id, hours, source)
  values ('60000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000005', 32, 'import') $$,
  'hours per assignment × period');
select throws_ok($$ insert into public.timesheet (assignment_id, period_id, hours)
  values ('60000000-0000-0000-0000-000000000005', '80000000-0000-0000-0000-000000000005', 8) $$,
  '23505', null, 'one row per assignment and period');
select throws_ok($$ update public.timesheet set hours = -1 where assignment_id = '60000000-0000-0000-0000-000000000005' $$,
  '23514', null, 'hours are non-negative');
select throws_ok($$ update public.timesheet set source = 'guess' where assignment_id = '60000000-0000-0000-0000-000000000005' $$,
  '23514', null, 'source is manual or import');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c5","role":"authenticated"}', true);
select is((select count(*)::int from public.timesheet), 0, 'viewer sees no hours');
reset role;

select * from finish();
rollback;
