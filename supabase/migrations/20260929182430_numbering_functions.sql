select public.setup_app_table('public.work_calendar_exception');
select public.setup_app_table('public.number_sequence');

-- I3 helper: exceptions win, otherwise Mon–Fri (spec 5.5). Holidays are never hard-coded.
create or replace function public.is_working_day(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select e.is_working from public.work_calendar_exception e where e.on_date = p_date),
    extract(isodow from p_date) < 6
  )
$$;

revoke all on function public.is_working_day(date) from public, anon;
grant execute on function public.is_working_day(date) to authenticated, service_role;

-- next_value only grows; the yearly reset of a year-scoped sequence is the single exception.
create or replace function public.guard_number_sequence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.next_value < old.next_value and new.current_year is not distinct from old.current_year then
    raise exception 'sequence_cannot_decrease'
      using errcode = 'TL020', detail = format('%s: %s → %s', old.key, old.next_value, new.next_value);
  end if;
  return new;
end;
$$;

create trigger guard_number_sequence
  before update on public.number_sequence
  for each row execute function public.guard_number_sequence();

-- I2: a document number is issued once, at issue time, under a row lock, so concurrent issues
-- get consecutive distinct numbers. Tokens: {seq} {yy} {yyyy} {contract}.
create or replace function public.issue_number(p_key text, p_doc_date date, p_contract text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seq public.number_sequence;
  v_year int := extract(year from p_doc_date)::int;
  v_value int;
begin
  if coalesce(public.current_app_role(), '') not in ('owner', 'finance')
     and coalesce(current_setting('app.actor', true), '') not like 'system:%' then
    raise exception 'not allowed to issue numbers' using errcode = '42501';
  end if;

  select * into v_seq from public.number_sequence where key = p_key for update;
  if not found then
    raise exception 'unknown number sequence %', p_key using errcode = 'TL021';
  end if;

  if v_seq.year_scoped then
    if v_seq.current_year is not null and v_year < v_seq.current_year then
      raise exception 'document year % is before sequence year %', v_year, v_seq.current_year
        using errcode = 'TL022';
    end if;
    if v_seq.current_year is distinct from v_year then
      v_seq.next_value := 1;
    end if;
  end if;

  v_value := v_seq.next_value;
  update public.number_sequence
     set next_value = v_value + 1,
         current_year = case when v_seq.year_scoped then v_year else current_year end
   where key = p_key;

  return replace(replace(replace(replace(v_seq.template,
    '{seq}', v_value::text),
    '{yyyy}', v_year::text),
    '{yy}', lpad((v_year % 100)::text, 2, '0')),
    '{contract}', coalesce(p_contract, ''));
end;
$$;

revoke all on function public.issue_number(text, date, text) from public, anon;
grant execute on function public.issue_number(text, date, text) to authenticated, service_role;
