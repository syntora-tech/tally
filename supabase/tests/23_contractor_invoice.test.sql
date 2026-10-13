begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

insert into public.company (id, name_en, name_ua) values ('10000000-0000-0000-0000-000000000023', 'S', 'С');
insert into public.payee (id, kind, legal_name_en) values ('30000000-0000-0000-0000-000000000023', 'other', 'Contractor 23');
insert into public.payee (id, kind, legal_name_ua) values ('31000000-0000-0000-0000-000000000023', 'fop', 'ФОП 23');
insert into public.contract (id, kind, number, company_id, payee_id)
  values ('50000000-0000-0000-0000-000000000023', 'fop', '9023', '10000000-0000-0000-0000-000000000023', '30000000-0000-0000-0000-000000000023');

-- A-090: a contractor invoice belongs to a contract of its payee, is frozen once issued.
select throws_ok($$ insert into public.contractor_invoice (contract_id, payee_id, invoice_date, amount, description_en, description_ua)
  values ('50000000-0000-0000-0000-000000000023', '31000000-0000-0000-0000-000000000023', '2039-10-13', 3000, 'S', 'Р') $$,
  'TL067', null, 'the contract must be the payee''s');
select lives_ok($$ insert into public.contractor_invoice (id, contract_id, payee_id, invoice_date, amount, description_en, description_ua)
  values ('90000000-0000-0000-0000-000000000023', '50000000-0000-0000-0000-000000000023', '30000000-0000-0000-0000-000000000023',
          '2039-10-13', 3000, 'S', 'Р') $$, 'a draft of the payee''s contract');
select throws_ok($$ update public.contractor_invoice set status = 'issued', number = '13102039'
  where id = '90000000-0000-0000-0000-000000000023' $$, 'TL003', null, 'issuing needs a snapshot');
update public.contractor_invoice set status = 'issued', number = '13102039', snapshot = '{}'
  where id = '90000000-0000-0000-0000-000000000023';
select throws_ok($$ update public.contractor_invoice set amount = 1 where id = '90000000-0000-0000-0000-000000000023' $$,
  'TL001', null, 'an issued invoice is frozen');
select throws_ok($$ delete from public.contractor_invoice where id = '90000000-0000-0000-0000-000000000023' $$,
  'TL001', null, 'an issued invoice is not deleted');
select throws_ok($$ insert into public.contractor_invoice (contract_id, payee_id, invoice_date, amount, description_en, description_ua, status, number, snapshot)
  values ('50000000-0000-0000-0000-000000000023', '30000000-0000-0000-0000-000000000023', '2039-10-13', 1, 'S', 'Р', 'issued', '13102039', '{}') $$,
  '23505', null, 'a contractor''s number is used once');
select lives_ok($$ update public.contractor_invoice set status = 'void', void_reason = 'Wrong month'
  where id = '90000000-0000-0000-0000-000000000023' $$, 'void with a reason');

select * from finish();
rollback;
