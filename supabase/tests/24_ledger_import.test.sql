begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000024a1', 'owner24a@t.local'),
  ('00000000-0000-0000-0000-0000000024a2', 'owner24b@t.local'),
  ('00000000-0000-0000-0000-0000000024c1', 'viewer24@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000024a1', 'owner24a@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000024a2', 'owner24b@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000024c1', 'viewer24@t.local', 'viewer');

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

-- A-120: a secret is visible and changeable only by its own user, even between owners.
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
select lives_ok($$ insert into public.user_secret (kind, ciphertext, hint) values ('anthropic_api_key', 'v1:a:b:c', 'abcd') $$,
  'a user stores their own key');
select throws_ok($$ insert into public.user_secret (user_id, kind, ciphertext, hint) values
  ('00000000-0000-0000-0000-0000000024a2', 'anthropic_api_key', 'v1:a:b:c', 'abcd') $$,
  '42501', null, 'nobody stores a key for someone else');
select throws_ok($$ insert into public.user_secret (kind, ciphertext, hint) values ('anthropic_api_key', 'plain', 'abcd') $$,
  '23514', null, 'only app-encrypted values are accepted');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a2');
select is((select count(*)::int from public.user_secret), 0, 'another owner does not see the key');
update public.user_secret set hint = 'zzzz';
delete from public.user_secret;
select pg_temp.reset_actor();
select is((select hint from public.user_secret where user_id = '00000000-0000-0000-0000-0000000024a1'), 'abcd',
  'another owner can neither change nor delete it');
select is((select count(*)::int from public.audit_log where table_name = 'user_secret'), 0,
  'the ciphertext never reaches the audit log');

-- A-121: imports are finance data; a committed one is frozen.
select pg_temp.act_as('00000000-0000-0000-0000-0000000024c1');
select throws_ok($$ insert into public.ledger_import (kind, rows) values ('bank', '[]') $$,
  '42501', null, 'a viewer cannot create imports');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
insert into public.ledger_import (id, kind, rows) values ('24000000-0000-0000-0000-000000000001', 'bank', '[]');
select lives_ok($$ update public.ledger_import set rows = '[{"key":"a"}]' where id = '24000000-0000-0000-0000-000000000001' $$,
  'a draft takes new suggestions');
select throws_ok($$ update public.ledger_import set status = 'committed' where id = '24000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a commit records its time');
update public.ledger_import set status = 'committed', committed_at = now() where id = '24000000-0000-0000-0000-000000000001';
select throws_ok($$ update public.ledger_import set rows = '[]' where id = '24000000-0000-0000-0000-000000000001' $$,
  'TL068', null, 'a committed import is frozen');
select throws_ok($$ delete from public.ledger_import where id = '24000000-0000-0000-0000-000000000001' $$,
  'TL068', null, 'a committed import is kept');
insert into public.ledger_import (id, kind, rows) values ('24000000-0000-0000-0000-000000000002', 'crypto', '[]');
select lives_ok($$ update public.ledger_import set status = 'discarded' where id = '24000000-0000-0000-0000-000000000002' $$,
  'a draft can be discarded');
select throws_ok($$ insert into public.ledger_import (kind, rows) values ('bank', '{}') $$,
  '23514', null, 'rows are an array');
select pg_temp.reset_actor();

select * from finish();
rollback;
