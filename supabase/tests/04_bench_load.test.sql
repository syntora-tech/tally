begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c4', 'viewer4@t.local');
insert into public.app_user (id, email, role) values ('00000000-0000-0000-0000-0000000000c4', 'viewer4@t.local', 'viewer');

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000004', 'S', 'С');
insert into public.client (id, legal_name) values ('40000000-0000-0000-0000-000000000004', 'Boosty');
insert into public.contract (id, kind, number, company_id, client_id)
  values ('50000000-0000-0000-0000-000000000004', 'client', 'SOW', '10000000-0000-0000-0000-000000000004', '40000000-0000-0000-0000-000000000004');
insert into public.person (id, full_name) values
  ('20000000-0000-0000-0000-000000000041', 'Busy'),
  ('20000000-0000-0000-0000-000000000042', 'Partial'),
  ('20000000-0000-0000-0000-000000000043', 'Internal only');
insert into public.assignment (person_id, contract_id, fte, starts_on) values
  ('20000000-0000-0000-0000-000000000041', '50000000-0000-0000-0000-000000000004', 0.5, '2026-01-01'),
  ('20000000-0000-0000-0000-000000000041', '50000000-0000-0000-0000-000000000004', 0.5, '2026-03-01'),
  ('20000000-0000-0000-0000-000000000042', '50000000-0000-0000-0000-000000000004', 0.5, '2026-01-01'),
  ('20000000-0000-0000-0000-000000000042', '50000000-0000-0000-0000-000000000004', 0.5, '2025-01-01');
update public.assignment set ends_on = '2025-12-31' where starts_on = '2025-01-01';
insert into public.assignment (person_id, is_internal, fte, starts_on)
  values ('20000000-0000-0000-0000-000000000043', true, 1, '2026-01-01');

-- As postgres (no app role) the function returns nothing.
select is((select count(*)::int from public.person_bench_load('2026-09-29')), 0, 'no rows without an app role');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);

select is((select count(*)::int from public.assignment), 0, 'viewer cannot read assignments directly');
select is((select load from public.person_bench_load('2026-09-29') where person_id = '20000000-0000-0000-0000-000000000041'),
  1.00::numeric, 'viewer sees the aggregate load of active client assignments');
select is((select load from public.person_bench_load('2026-09-29') where person_id = '20000000-0000-0000-0000-000000000042'),
  0.50::numeric, 'ended assignments are not counted');
select is((select count(*)::int from public.person_bench_load('2026-09-29') where person_id = '20000000-0000-0000-0000-000000000043'),
  0, 'internal assignments are not counted');

reset role;
select * from finish();
rollback;
