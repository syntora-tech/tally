begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000001a6', 'owner16@t.local'),
  ('00000000-0000-0000-0000-0000000001b6', 'finance16@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000001a6', 'owner16@t.local', 'owner'),
  ('00000000-0000-0000-0000-0000000001b6', 'finance16@t.local', 'finance');

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

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000016', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000016', 'Client 16');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000016', 'client', 'C-16', '10000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000016');
insert into public.invoice (id, client_id, contract_id, issue_date, due_date, total, status, number, snapshot)
  values ('a0000000-0000-0000-0000-000000000016', '40000000-0000-0000-0000-000000000016', '50000000-0000-0000-0000-000000000016',
          '2031-04-01', '2031-04-20', 1000, 'issued', 'WO-16', '{"doc":{}}');


select pg_temp.act_as('00000000-0000-0000-0000-0000000001b6');
select throws_ok($$ update public.invoice set status = 'written_off', written_off_on = '2031-09-01', write_off_reason = 'Client vanished'
  where id = 'a0000000-0000-0000-0000-000000000016' $$, '42501', null, 'finance cannot write off');
select throws_ok($$ update public.invoice set written_off_on = '2031-09-01' where id = 'a0000000-0000-0000-0000-000000000016' $$,
  'TL001', null, 'write-off details only come with the status');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000001a6');
select throws_ok($$ update public.invoice set status = 'written_off' where id = 'a0000000-0000-0000-0000-000000000016' $$,
  '23514', null, 'a write-off needs a date and a reason');
select lives_ok($$ update public.invoice set status = 'written_off', written_off_on = '2031-09-01', write_off_reason = 'Client vanished'
  where id = 'a0000000-0000-0000-0000-000000000016' $$, 'owner writes off with a date and a reason');
select throws_ok($$ update public.invoice set write_off_reason = 'Other' where id = 'a0000000-0000-0000-0000-000000000016' $$,
  'TL001', null, 'write-off details are final');
select throws_ok($$ update public.invoice set status = 'issued' where id = 'a0000000-0000-0000-0000-000000000016' $$,
  'TL002', null, 'a written-off invoice does not come back');
select pg_temp.reset_actor();

select is((select status::text from public.invoice where id = 'a0000000-0000-0000-0000-000000000016'), 'written_off',
  'status stays written_off');

select * from finish();
rollback;
