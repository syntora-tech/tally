-- Document links are polymorphic (6.9), so no foreign key keeps them honest: check the target on
-- write and drop the links when the target goes away (A-071).
create or replace function public.document_link_target_exists(p_type text, p_id uuid)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  return case p_type
    when 'person' then exists (select 1 from public.person where id = p_id)
    when 'payee' then exists (select 1 from public.payee where id = p_id)
    when 'client' then exists (select 1 from public.client where id = p_id)
    when 'contract' then exists (select 1 from public.contract where id = p_id)
    when 'assignment' then exists (select 1 from public.assignment where id = p_id)
    when 'invoice' then exists (select 1 from public.invoice where id = p_id)
    when 'supplier_act' then exists (select 1 from public.supplier_act where id = p_id)
    when 'trip' then exists (select 1 from public.trip where id = p_id)
    when 'transaction' then exists (select 1 from public."transaction" where id = p_id)
    -- Unknown types are left to document_link_entity_type_check.
    else true
  end;
end;
$$;

create or replace function public.guard_document_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.document_link_target_exists(new.entity_type, new.entity_id) then
    raise exception 'document_link_target_missing'
      using errcode = 'TL061', detail = new.entity_type || ' ' || new.entity_id::text;
  end if;
  return new;
end;
$$;

create trigger guard_document_link
  before insert or update of entity_type, entity_id on public.document_link
  for each row execute function public.guard_document_link();

create or replace function public.drop_document_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.document_link where entity_type = tg_argv[0] and entity_id = old.id;
  return old;
end;
$$;

create trigger drop_document_links after delete on public.person
  for each row execute function public.drop_document_links('person');
create trigger drop_document_links after delete on public.payee
  for each row execute function public.drop_document_links('payee');
create trigger drop_document_links after delete on public.client
  for each row execute function public.drop_document_links('client');
create trigger drop_document_links after delete on public.contract
  for each row execute function public.drop_document_links('contract');
create trigger drop_document_links after delete on public.assignment
  for each row execute function public.drop_document_links('assignment');
create trigger drop_document_links after delete on public.invoice
  for each row execute function public.drop_document_links('invoice');
create trigger drop_document_links after delete on public.supplier_act
  for each row execute function public.drop_document_links('supplier_act');
create trigger drop_document_links after delete on public.trip
  for each row execute function public.drop_document_links('trip');
create trigger drop_document_links after delete on public."transaction"
  for each row execute function public.drop_document_links('transaction');

-- Links left behind by targets deleted before this migration.
delete from public.document_link dl
where not public.document_link_target_exists(dl.entity_type, dl.entity_id);
