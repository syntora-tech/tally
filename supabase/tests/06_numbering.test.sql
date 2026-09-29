begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b6', 'finance6@t.local'),
  ('00000000-0000-0000-0000-0000000000c6', 'viewer6@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000b6', 'finance6@t.local', 'finance'),
  ('00000000-0000-0000-0000-0000000000c6', 'viewer6@t.local', 'viewer');

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

-- Working days (5.5, I3 helper). Far-future dates avoid clashing with real exceptions.
insert into public.work_calendar_exception (on_date, is_working, reason) values
  ('2031-01-01', false, 'New Year'), ('2031-01-04', true, 'Working Saturday');
select is(public.is_working_day('2031-01-01'), false, 'holiday exception is not a working day');
select is(public.is_working_day('2031-01-04'), true, 'working Saturday exception');
select is(public.is_working_day('2031-01-02'), true, 'plain Thursday');
select is(public.is_working_day('2031-01-05'), false, 'plain Sunday');

-- issue_number (I2): formats, year reset, never decreasing.
insert into public.number_sequence (key, template, next_value, year_scoped, current_year) values
  ('test:invoice', '{seq}/{yy}', 25, true, 2030),
  ('test:act', '1001 - А{seq}', 13, false, null);

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b6');
select is(public.issue_number('test:invoice', '2030-10-01'), '25/30', 'invoice number {seq}/{yy}');
select is(public.issue_number('test:invoice', '2030-11-02'), '26/30', 'next invoice number');
select is(public.issue_number('test:invoice', '2031-01-04'), '1/31', 'year-scoped sequence resets in a new year');
select throws_ok($$ select public.issue_number('test:invoice', '2030-12-31') $$,
  'TL022', null, 'cannot issue into a previous sequence year');
select is(public.issue_number('test:act', '2030-09-30'), '1001 - А13', 'act number template');
update public.number_sequence set next_value = 99 where key = 'test:act';
select pg_temp.reset_actor();
select is((select next_value from public.number_sequence where key = 'test:act'), 14,
  'finance cannot edit sequences directly (RLS leaves the row unchanged)');

select throws_ok($$ update public.number_sequence set next_value = 5 where key = 'test:act' $$,
  'TL020', 'sequence_cannot_decrease', 'next_value never decreases');
select lives_ok($$ update public.number_sequence set next_value = 20 where key = 'test:act' $$,
  'next_value may be raised');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000c6');
select throws_ok($$ select public.issue_number('test:act', '2030-09-30') $$,
  '42501', null, 'viewer cannot issue numbers');
select throws_ok($$ insert into public.work_calendar_exception (on_date, is_working, reason) values ('2031-02-02', false, 'x') $$,
  '42501', null, 'only owner edits the calendar');
select pg_temp.reset_actor();

select * from finish();
rollback;
