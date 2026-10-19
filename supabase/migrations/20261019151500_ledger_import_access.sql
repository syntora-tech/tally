-- A-120: personal secrets. Grants and updated_at only; no audit trigger, so the ciphertext is not
-- copied into audit_log, which other owners can read.
grant select, insert, update, delete on public.user_secret to authenticated;
grant all on public.user_secret to service_role;
revoke all on public.user_secret from anon;
create trigger set_updated_at before update on public.user_secret
  for each row execute function public.set_updated_at();

-- A-121/A-122: statement and crypto imports awaiting review.
select public.setup_app_table('public.ledger_import');

-- TL068: a committed or discarded import is a record of what was booked; only drafts change.
create or replace function public.guard_ledger_import()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'committed' then
      raise exception 'ledger_import_frozen' using errcode = 'TL068', detail = 'committed imports cannot be deleted';
    end if;
    return old;
  end if;
  if old.status <> 'draft' then
    raise exception 'ledger_import_frozen' using errcode = 'TL068', detail = 'only draft imports change';
  end if;
  if new.kind <> old.kind or new.created_by is distinct from old.created_by then
    raise exception 'ledger_import_frozen' using errcode = 'TL068', detail = 'kind and author are fixed';
  end if;
  return new;
end;
$$;

create trigger guard_ledger_import before update or delete on public.ledger_import
  for each row execute function public.guard_ledger_import();
