-- A-078: a part points at a signed package; a package is never itself a part, and keeps its
-- type while it has parts. SQLSTATE TL063 is mapped by the service layer.
create or replace function public.guard_document_package()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.package_id is not null then
    if new.package_id = new.id or new.type = 'package' then
      raise exception 'package_part_invalid' using errcode = 'TL063';
    end if;
    if not exists (
      select 1 from public.document d where d.id = new.package_id and d.type = 'package'
    ) then
      raise exception 'package_part_invalid' using errcode = 'TL063';
    end if;
  elsif new.package_pages is not null then
    raise exception 'package_part_invalid' using errcode = 'TL063';
  end if;
  if tg_op = 'UPDATE' and old.type = 'package' and new.type <> 'package' and exists (
    select 1 from public.document d where d.package_id = new.id
  ) then
    raise exception 'package_has_parts' using errcode = 'TL063';
  end if;
  return new;
end;
$$;

create trigger guard_document_package
  before insert or update of type, package_id, package_pages on public.document
  for each row execute function public.guard_document_package();
