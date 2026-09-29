begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

-- Count only audit rows written by this test; the shared DB may hold older ones.
create temp table audit_start on commit drop as select coalesce(max(id), 0) as id from public.audit_log;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@t.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'finance@t.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000b1', 'finance@t.local', 'finance'),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@t.local', 'viewer');

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

-- Fixtures as postgres.
insert into public.company (id, name_en, name_ua) values
  ('10000000-0000-0000-0000-000000000001', 'LLC "SYNTORA"', 'ТОВ «СІНТОРА»');
insert into public.person (id, full_name, stack, market_rate_usd) values
  ('20000000-0000-0000-0000-000000000001', 'Andrii H.', '{AWS,Kubernetes}', '60');
insert into public.payee (id, kind, legal_name_ua, iban, person_id) values
  ('30000000-0000-0000-0000-000000000001', 'fop', 'ФОП Тест', 'UA000', '20000000-0000-0000-0000-000000000001');
insert into public.client (id, legal_name) values
  ('40000000-0000-0000-0000-000000000001', 'Creditor Group Corp.');

-- Constraints.
select throws_ok($$ insert into public.payee (kind, legal_name_ua) values ('bank', 'X') $$,
  '23514', null, 'payee kind is restricted');
select throws_ok($$ insert into public.payee (kind) values ('fop') $$,
  '23514', null, 'payee needs a legal name');
select throws_ok($$ insert into public.client (legal_name, default_currency) values ('X', 'usd') $$,
  '23514', null, 'currency must be an upper-case code');
select lives_ok($$ insert into public.client (legal_name, default_currency) values ('Y', 'USDT') $$,
  'stablecoin codes are allowed');
select throws_ok($$ insert into public.person (full_name, allocation) values ('X', 'freelance') $$,
  '23514', null, 'person allocation is restricted');
select throws_ok($$ insert into public.person (full_name, market_rate_usd) values ('X', -1) $$,
  '23514', null, 'market rate is non-negative');
select lives_ok($$ update public.person set default_payee_id = '30000000-0000-0000-0000-000000000001'
  where id = '20000000-0000-0000-0000-000000000001' $$, 'person ↔ payee circular references work');

-- Audit and updated_at are wired.
select is((select count(*)::int from public.audit_log where table_name in ('company', 'person', 'payee', 'client') and id > (select id from audit_start)),
  6, 'inserts and updates on parties are audited');

-- viewer: reads person and client, never payee or company; cannot write.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
-- Positive counts are scoped to fixture rows: the local DB is shared with e2e and import data.
select is((select count(*)::int from public.person where id = '20000000-0000-0000-0000-000000000001'), 1, 'viewer reads person');
select is((select count(*)::int from public.client where id = '40000000-0000-0000-0000-000000000001' or (legal_name = 'Y' and default_currency = 'USDT')), 2, 'viewer reads client');
select is((select count(*)::int from public.payee), 0, 'viewer does not see payee (6.2 AC)');
select is((select count(*)::int from public.company), 0, 'viewer does not see company');
select throws_ok($$ insert into public.person (full_name) values ('Z') $$,
  '42501', null, 'viewer cannot create person');
select pg_temp.reset_actor();

-- finance: reads/writes person, client, payee; reads company but cannot change it.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.payee where id = '30000000-0000-0000-0000-000000000001'), 1, 'finance reads payee');
select lives_ok($$ insert into public.payee (kind, legal_name_en) values ('crypto', 'Wallet') $$,
  'finance creates payee');
select lives_ok($$ update public.client set short_name = 'Creditor' where legal_name = 'Creditor Group Corp.' $$,
  'finance edits client');
select is((select count(*)::int from public.company where id = '10000000-0000-0000-0000-000000000001'), 1, 'finance reads company');
select throws_ok($$ insert into public.company (name_en, name_ua) values ('X', 'X') $$,
  '42501', null, 'finance cannot create company');
update public.company set name_en = 'hacked' where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.reset_actor();
select is((select name_en from public.company where id = '10000000-0000-0000-0000-000000000001'), 'LLC "SYNTORA"', 'finance cannot update company');

-- owner edits company.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$ update public.company set legal_code = '46140580' where id = '10000000-0000-0000-0000-000000000001' $$, 'owner edits company');
select pg_temp.reset_actor();
select is((select legal_code from public.company where id = '10000000-0000-0000-0000-000000000001'), '46140580', 'owner change persisted');

-- anon.
set local role anon;
select throws_ok($$ select * from public.person $$, '42501', null, 'anon has no access to person');
reset role;

select * from finish();
rollback;
