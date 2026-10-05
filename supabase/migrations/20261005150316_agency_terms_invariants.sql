select public.setup_app_table('public.agency_terms');

-- I10 for agency terms, like client and person terms.
create trigger guard_closed_period
  before insert or update or delete on public.agency_terms
  for each row execute function public.guard_terms_closed_period();

-- An agency fee line lives only in an agency item and a person's pay only in a person item (A-068).
create or replace function public.guard_payroll_line_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.agency_fee <> exists (select 1 from public.payroll_item i
                                where i.id = new.payroll_item_id and i.kind = 'agency') then
    raise exception 'payroll_line_kind_mismatch' using errcode = 'TL057';
  end if;
  return new;
end;
$$;

create trigger guard_payroll_line_kind
  before insert or update of agency_fee, payroll_item_id on public.payroll_line
  for each row execute function public.guard_payroll_line_kind();
