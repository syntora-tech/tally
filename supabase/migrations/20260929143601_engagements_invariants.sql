select public.setup_app_table('public.contract');
select public.setup_app_table('public.assignment');
select public.setup_app_table('public.billing_terms');
select public.setup_app_table('public.pay_terms');
select public.setup_app_table('public.period');

-- Last day of the latest closed period, or null when nothing is closed.
create or replace function public.last_closed_period_end()
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (max(p.month) + interval '1 month' - interval '1 day')::date
  from public.period p
  where p.status = 'closed'
$$;

revoke all on function public.last_closed_period_end() from public, anon;
grant execute on function public.last_closed_period_end() to authenticated, service_role;

-- I10: term versions cannot be created, changed or removed back-dated into a closed period.
-- SQLSTATE TL010 is mapped to a user-facing message by the service layer.
create or replace function public.guard_terms_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_closed_end date := public.last_closed_period_end();
begin
  if v_closed_end is null then
    return coalesce(new, old);
  end if;
  if (tg_op in ('UPDATE', 'DELETE') and old.valid_from <= v_closed_end)
     or (tg_op in ('INSERT', 'UPDATE') and new.valid_from <= v_closed_end) then
    raise exception 'terms_in_closed_period'
      using errcode = 'TL010',
            detail = format('valid_from must be after %s', v_closed_end),
            hint = to_char(v_closed_end + 1, 'YYYY-MM-DD');
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_closed_period
  before insert or update or delete on public.billing_terms
  for each row execute function public.guard_terms_closed_period();

create trigger guard_closed_period
  before insert or update or delete on public.pay_terms
  for each row execute function public.guard_terms_closed_period();
