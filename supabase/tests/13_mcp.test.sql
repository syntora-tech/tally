begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ad', 'owner13@t.local'),
  ('00000000-0000-0000-0000-0000000000fd', 'finance13@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000ad', 'owner13@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000000fd', 'finance13@t.local', 'finance');

insert into public.mcp_call_log (client_id, tool, outcome, duration_ms) values ('pat_t13', 'get_balances', 'ok', 5);
insert into public.mcp_idempotency (client_id, key, tool, response) values ('pat_t13', 'k1', 'add_transactions', '{}');

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000ad');
select lives_ok($$ insert into public.mcp_client_policy (client_id, user_id, client_name, profile, token_hash)
  values ('pat_t13', '00000000-0000-0000-0000-0000000000ad', 'Claude Code', 'assistant', 'h13') $$,
  'owner creates an MCP client');
select throws_ok($$ insert into public.mcp_client_policy (client_id, user_id, client_name, profile)
  values ('pat_t13b', '00000000-0000-0000-0000-0000000000ad', 'X', 'admin') $$,
  '23514', null, 'unknown profile is rejected');
select is((select count(*)::int from public.mcp_call_log where client_id = 'pat_t13'), 1, 'owner reads the call log');
select throws_ok($$ select * from public.mcp_idempotency $$, '42501', null, 'idempotency is system-only');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000fd');
select is((select count(*)::int from public.mcp_client_policy where client_id = 'pat_t13'), 0, 'finance does not see MCP clients');
select is((select count(*)::int from public.mcp_call_log where client_id = 'pat_t13'), 0, 'finance does not see the call log');
select throws_ok($$ insert into public.mcp_client_policy (client_id, user_id, client_name)
  values ('pat_t13c', '00000000-0000-0000-0000-0000000000fd', 'Y') $$,
  '42501', null, 'finance cannot create MCP clients');
reset role;

select * from finish();
rollback;
