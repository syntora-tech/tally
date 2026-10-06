select public.setup_app_table('public.contract_annex');

-- An assignment or invoice may name only a SOW/annex of its own contract (A-072).
create or replace function public.guard_annex_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.annex_id is not null and not exists (
    select 1 from public.contract_annex a
     where a.id = new.annex_id and a.contract_id is not distinct from new.contract_id
  ) then
    raise exception 'annex_contract_mismatch' using errcode = 'TL062',
      detail = new.annex_id::text;
  end if;
  return new;
end;
$$;

create trigger guard_annex_contract
  before insert or update of annex_id, contract_id on public.assignment
  for each row execute function public.guard_annex_contract();
create trigger guard_annex_contract
  before insert or update of annex_id, contract_id on public.invoice
  for each row execute function public.guard_annex_contract();

create or replace function public.guard_annex_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_id <> old.contract_id and (
    exists (select 1 from public.assignment where annex_id = old.id)
    or exists (select 1 from public.invoice where annex_id = old.id)
  ) then
    raise exception 'annex_contract_mismatch' using errcode = 'TL062',
      detail = old.id::text;
  end if;
  return new;
end;
$$;

create trigger guard_annex_move
  before update of contract_id on public.contract_annex
  for each row execute function public.guard_annex_move();

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
    when 'contract_annex' then exists (select 1 from public.contract_annex where id = p_id)
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

create trigger drop_document_links after delete on public.contract_annex
  for each row execute function public.drop_document_links('contract_annex');
