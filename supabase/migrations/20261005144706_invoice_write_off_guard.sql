-- Writing off a client debt (5.3 rule 7, A-065) is the owner's call and is final: the date and the
-- reason are set together with the status and never change afterwards.
create or replace function public.guard_invoice_write_off()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'written_off' and old.status <> 'written_off'
     and coalesce(public.current_app_role(), '') <> 'owner' then
    raise exception 'only owner can write off an invoice' using errcode = '42501';
  end if;
  if (new.written_off_on, new.write_off_reason) is distinct from (old.written_off_on, old.write_off_reason)
     and not (new.status = 'written_off' and old.status <> 'written_off') then
    raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'write-off details are final';
  end if;
  return new;
end;
$$;

create trigger guard_invoice_write_off
  before update on public.invoice
  for each row execute function public.guard_invoice_write_off();
