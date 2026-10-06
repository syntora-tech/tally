begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(20);

-- Count only audit rows written by this test; the shared DB may hold older ones.
create temp table audit_start on commit drop as select coalesce(max(id), 0) as id from public.audit_log;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b3', 'finance3@t.local'),
  ('00000000-0000-0000-0000-0000000000c3', 'viewer3@t.local');
insert into public.app_user (id, email, role) values
  ('00000000-0000-0000-0000-0000000000b3', 'finance3@t.local', 'finance'),
  ('00000000-0000-0000-0000-0000000000c3', 'viewer3@t.local', 'viewer');

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

-- number_key (spec 5.6, 9.1): three spellings share one key.
insert into public.document (id, type, number, title) values
  ('70000000-0000-0000-0000-000000000001', 'act', '1003  -А4', 'Act A'),
  ('70000000-0000-0000-0000-000000000002', 'act', '1003 - А4', 'Act B'),
  ('70000000-0000-0000-0000-000000000003', 'act', '1003-A4', 'Act C');
select is((select count(distinct number_key)::int from public.document where id::text like '70000000-0000-0000-0000-00000000000_'), 1, 'number_key unifies spacing, dashes, Latin A');
select is((select number_key from public.document where id = '70000000-0000-0000-0000-000000000001'), '1003А4', 'number_key value matches the domain function');
select throws_ok($$ update public.document set number_key = 'x' $$, '428C9', null, 'number_key is generated');

select throws_ok($$ insert into public.document (type, title) values ('passport', 'X') $$,
  '23514', null, 'unknown document type rejected');
select lives_ok($$ insert into public.document (id, type, title) values ('70000000-0000-0000-0000-000000000010', 'nda', 'NDA without links') $$,
  'document without links is allowed (6.9 AC)');

-- Versions form a single chain.
insert into public.document (id, type, title) values ('70000000-0000-0000-0000-000000000020', 'cv', 'CV v1');
select lives_ok($$ insert into public.document (type, title, version, supersedes_id)
  values ('cv', 'CV v2', 2, '70000000-0000-0000-0000-000000000020') $$, 'new CV version supersedes the old one');
select throws_ok($$ insert into public.document (type, title, version, supersedes_id)
  values ('cv', 'CV v2 bis', 2, '70000000-0000-0000-0000-000000000020') $$,
  '23505', null, 'a version is superseded at most once');

-- Links: one document tied to person, client and trip at once (6.9 AC).
insert into public.person (id, full_name) values ('70000000-0000-0000-0000-0000000000a1', 'Doc Person');
insert into public.client (id, legal_name) values ('70000000-0000-0000-0000-0000000000a2', 'Doc Client');
insert into public.trip (id, title, starts_on, ends_on) values ('70000000-0000-0000-0000-0000000000a3', 'Doc Trip', '2026-06-01', '2026-06-03');
select lives_ok($$ insert into public.document_link (document_id, entity_type, entity_id) values
  ('70000000-0000-0000-0000-000000000010', 'person', '70000000-0000-0000-0000-0000000000a1'),
  ('70000000-0000-0000-0000-000000000010', 'client', '70000000-0000-0000-0000-0000000000a2'),
  ('70000000-0000-0000-0000-000000000010', 'trip', '70000000-0000-0000-0000-0000000000a3') $$,
  'one document linked to three entities');
select throws_ok($$ insert into public.document_link (document_id, entity_type, entity_id)
  values ('70000000-0000-0000-0000-000000000010', 'contract', gen_random_uuid()) $$,
  'TL061', null, 'a link to a missing record is rejected (A-071)');
delete from public.trip where id = '70000000-0000-0000-0000-0000000000a3';
select is((select count(*)::int from public.document_link where entity_id = '70000000-0000-0000-0000-0000000000a3'), 0,
  'deleting the record drops its links');
select throws_ok($$ insert into public.document_link (document_id, entity_type, entity_id)
  values ('70000000-0000-0000-0000-000000000010', 'planet', gen_random_uuid()) $$,
  '23514', null, 'unknown entity type rejected');

-- RLS.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is((select count(*)::int from public.document where id::text like '70000000-%' or title = 'CV v2'), 6, 'viewer reads documents');
select throws_ok($$ insert into public.document (type, title) values ('other', 'X') $$,
  '42501', null, 'viewer cannot add documents');
select throws_ok($$ select * from public.drive_folder $$, '42501', null, 'drive_folder is not exposed to users');
select pg_temp.reset_actor();

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b3');
select lives_ok($$ insert into public.document (type, title, url) values ('other', 'Vchasno link', 'https://vchasno.ua/x') $$,
  'finance adds a link-only document');
select pg_temp.reset_actor();

select is((select count(*)::int from public.audit_log where table_name = 'document_link' and id > (select id from audit_start)), 4, 'links are audited');

-- A-078: signed packages and their parts.
insert into public.document (id, type, title) values
  ('70000000-0000-0000-0000-0000000000a1', 'package', 'MSA + SOW 1'),
  ('70000000-0000-0000-0000-0000000000a2', 'contract', 'Plain contract');
select lives_ok($$ insert into public.document (type, title, package_id, package_pages)
  values ('sow', 'SOW 1', '70000000-0000-0000-0000-0000000000a1', '11-13') $$,
  'a part points at a package with its pages');
select throws_ok($$ insert into public.document (type, title, package_id)
  values ('sow', 'Bad part', '70000000-0000-0000-0000-0000000000a2') $$,
  'TL063', null, 'a part of a document that is not a package is rejected');
select throws_ok($$ insert into public.document (type, title, package_pages) values ('sow', 'Pages only', '1-2') $$,
  'TL063', null, 'pages without a package are rejected');
select throws_ok($$ update public.document set type = 'contract' where id = '70000000-0000-0000-0000-0000000000a1' $$,
  'TL063', null, 'a package with parts keeps its type');

select * from finish();
rollback;
