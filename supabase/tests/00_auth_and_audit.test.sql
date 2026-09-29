begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(24);

-- Count only audit rows written by this test; the shared DB may hold older ones.
create temp table audit_start on commit drop as select coalesce(max(id), 0) as id from public.audit_log;

-- Fixtures (as postgres, i.e. "Studio"): three users with different roles.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'finance@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@test.local'),
  ('00000000-0000-0000-0000-00000000000d', 'inactive@test.local');

insert into public.app_user (id, email, role, is_active) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local', 'owner', true),
  ('00000000-0000-0000-0000-00000000000b', 'finance@test.local', 'finance', true),
  ('00000000-0000-0000-0000-00000000000c', 'viewer@test.local', 'viewer', true),
  ('00000000-0000-0000-0000-00000000000d', 'inactive@test.local', 'owner', false);

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.reset_actor() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.actor', '', true);
  perform set_config('app.via', '', true);
  perform set_config('app.client_id', '', true);
end $$;

-- I8: direct SQL (Studio) is audited with a null actor.
select is(
  (select count(*)::int from public.audit_log where table_name = 'app_user' and action = 'INSERT' and id > (select id from audit_start)),
  4, 'direct inserts are audited');
select ok(
  (select bool_and(actor is null) from public.audit_log where table_name = 'app_user' and id > (select id from audit_start)),
  'Studio changes have actor = null');

update public.app_user set role = 'finance' where email = 'viewer@test.local';
select is(
  (select old ->> 'role' || '->' || (new ->> 'role') from public.audit_log
    where table_name = 'app_user' and action = 'UPDATE' order by id desc limit 1),
  'viewer->finance', 'update records old and new rows');
select is(
  (select row_id from public.audit_log where action = 'UPDATE' order by id desc limit 1),
  '00000000-0000-0000-0000-00000000000c'::uuid, 'row_id is the updated row id');
update public.app_user set role = 'viewer' where email = 'viewer@test.local';

select lives_ok(
  $$ update public.app_user set role = role where email = 'viewer@test.local' $$,
  'no-op update succeeds');
select is(
  (select count(*)::int from public.audit_log where action = 'UPDATE' and id > (select id from audit_start)),
  2, 'no-op updates are not audited');

-- System jobs and MCP identify themselves through app.* settings.
select set_config('app.actor', 'system:import', true);
select set_config('app.via', 'mcp', true);
select set_config('app.client_id', 'client-123', true);
update public.app_user set is_active = true, email = 'viewer2@test.local' where email = 'viewer@test.local';
select is(
  (select actor_label || '|' || via || '|' || client_id from public.audit_log order by id desc limit 1),
  'system:import|mcp|client-123', 'app.actor / app.via / app.client_id are recorded');
select pg_temp.reset_actor();

-- updated_at trigger.
update public.app_user set updated_at = '2000-01-01' where email = 'finance@test.local';
update public.app_user set role = 'finance' , email = 'finance2@test.local' where email = 'finance@test.local';
select ok(
  (select updated_at > '2000-01-02' from public.app_user where email = 'finance2@test.local'),
  'updated_at is refreshed on update');

-- current_app_role().
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is(public.current_app_role(), 'owner', 'owner role resolved from app_user');
select pg_temp.reset_actor();
select pg_temp.act_as('00000000-0000-0000-0000-00000000000d');
select is(public.current_app_role(), null, 'inactive user has no role');
select pg_temp.reset_actor();
select pg_temp.act_as('00000000-0000-0000-0000-0000000000ff');
select is(public.current_app_role(), null, 'unknown user has no role');
select pg_temp.reset_actor();

-- Actor from the JWT when acting as a user.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
update public.app_user set role = 'finance' where email = 'viewer2@test.local';
select pg_temp.reset_actor();
select is(
  (select actor from public.audit_log order by id desc limit 1),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'actor = auth.uid() for user changes');
update public.app_user set role = 'viewer' where email = 'viewer2@test.local';

-- RLS on app_user.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select results_eq(
  $$ select email from public.app_user $$,
  $$ values ('viewer2@test.local') $$, 'viewer sees only own row');
update public.app_user set role = 'owner' where id = '00000000-0000-0000-0000-00000000000c';
select pg_temp.reset_actor();
select is(
  (select role::text from public.app_user where id = '00000000-0000-0000-0000-00000000000c'),
  'viewer', 'viewer cannot promote self');

select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select throws_ok(
  $$ insert into public.app_user (id, email, role) values ('00000000-0000-0000-0000-00000000000d', 'x@test.local', 'owner') $$,
  '42501', null, 'viewer cannot insert app_user');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*)::int from public.app_user), 1, 'finance sees only own row');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.app_user), 4, 'owner sees all users');
select lives_ok(
  $$ update public.app_user set role = 'finance' where id = '00000000-0000-0000-0000-00000000000c' $$,
  'owner can change roles');
select pg_temp.reset_actor();
select is(
  (select role::text from public.app_user where id = '00000000-0000-0000-0000-00000000000c'),
  'finance', 'owner role change persisted');
update public.app_user set role = 'viewer' where id = '00000000-0000-0000-0000-00000000000c';

-- RLS on audit_log.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.audit_log), 0, 'viewer cannot read audit_log');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select ok((select count(*) > 0 from public.audit_log), 'finance reads audit_log');
select throws_ok(
  $$ insert into public.audit_log (table_name, action) values ('x', 'INSERT') $$,
  '42501', null, 'users cannot write audit_log directly');
select throws_ok(
  $$ delete from public.audit_log $$,
  '42501', null, 'users cannot delete audit_log');
select pg_temp.reset_actor();

-- anon has no access at all.
set local role anon;
select throws_ok($$ select * from public.app_user $$, '42501', null, 'anon cannot read app_user');
reset role;

select * from finish();
rollback;
