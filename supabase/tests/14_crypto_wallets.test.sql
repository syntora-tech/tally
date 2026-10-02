begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

create temp table audit_start on commit drop as select coalesce(max(id), 0) as id from public.audit_log;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000014b1', 'finance14@t.local'),
  ('00000000-0000-0000-0000-0000000014c1', 'viewer14@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000014b1', 'finance14@t.local', 'finance'),
  ('00000000-0000-0000-0000-0000000014c1', 'viewer14@t.local', 'viewer');

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

insert into public.person (id, full_name) values ('14000000-0000-0000-0000-000000000001', 'Wallet Owner');
insert into public.client (id, legal_name) values ('14000000-0000-0000-0000-000000000002', 'Wallet Client');

-- Owner: exactly one of person and client.
select throws_ok($$ insert into public.crypto_wallet (network, address) values ('ETH', '0xa1') $$,
  '23514', null, 'a wallet needs an owner');
select throws_ok($$ insert into public.crypto_wallet (person_id, client_id, network, address) values
  ('14000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000002', 'ETH', '0xa2') $$,
  '23514', null, 'a wallet has only one owner');

-- Several wallets per owner, one owner per (network, address).
select lives_ok($$ insert into public.crypto_wallet (person_id, network, address) values
  ('14000000-0000-0000-0000-000000000001', 'ETH', '0xa3'),
  ('14000000-0000-0000-0000-000000000001', 'TRON', 'Ta3'),
  ('14000000-0000-0000-0000-000000000001', 'BSC', '0xa3') $$,
  'one person holds several wallets, the same EVM address on several networks');
select throws_ok($$ insert into public.crypto_wallet (client_id, network, address) values
  ('14000000-0000-0000-0000-000000000002', 'ETH', '0xa3') $$,
  '23505', null, 'an address on a network belongs to one owner');
select throws_ok($$ insert into public.crypto_wallet (client_id, network, address) values
  ('14000000-0000-0000-0000-000000000002', 'eth', '0xa4') $$,
  '23514', null, 'network is one of the fixed codes');
select throws_ok($$ insert into public.crypto_wallet (client_id, network, address) values
  ('14000000-0000-0000-0000-000000000002', 'ETH', ' 0xa5') $$,
  '23514', null, 'address is stored trimmed');

-- Our own accounts: address needs a network and is unique per network.
select throws_ok($$ insert into public.account (name, kind, currency, address, opening_date) values
  ('W14 no net', 'crypto', 'USDT', '0xb1', '2026-01-01') $$,
  '23514', null, 'account address needs a network');
select lives_ok($$ insert into public.account (name, kind, currency, network, address, opening_date) values
  ('W14 a', 'crypto', 'USDT', 'TRON', 'Tb1', '2026-01-01') $$, 'crypto account with address');
select throws_ok($$ insert into public.account (name, kind, currency, network, address, opening_date) values
  ('W14 b', 'crypto', 'USDC', 'TRON', 'Tb1', '2026-01-01') $$,
  '23505', null, 'account address is unique per network');
select throws_ok($$ insert into public.payee (kind, legal_name_en, wallet_network) values ('crypto', 'X', 'Tron') $$,
  '23514', null, 'payee wallet network is one of the fixed codes');

select is((select count(*)::int from public.audit_log where table_name = 'crypto_wallet' and id > (select id from audit_start)),
  3, 'wallet inserts are audited');

-- viewer does not see wallets; finance reads and writes them.
select pg_temp.act_as('00000000-0000-0000-0000-0000000014c1');
select is((select count(*)::int from public.crypto_wallet), 0, 'viewer does not see wallets');
select pg_temp.act_as('00000000-0000-0000-0000-0000000014b1');
select is((select count(*)::int from public.crypto_wallet where person_id = '14000000-0000-0000-0000-000000000001'),
  3, 'finance reads wallets');
select lives_ok($$ update public.crypto_wallet set is_active = false where address = 'Ta3' $$,
  'finance deactivates a wallet');
select pg_temp.reset_actor();

select * from finish();
rollback;
