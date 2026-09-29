select public.setup_app_table('public.invoice');
select public.setup_app_table('public.invoice_line');

-- Audit also records why a guarded change was made (app.reason), e.g. reopening a period.
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_id text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
  end if;
  if tg_op = 'UPDATE' and v_old = v_new then
    return null;
  end if;

  v_id := coalesce(v_new ->> 'id', v_old ->> 'id');

  insert into public.audit_log (table_name, row_id, action, old, new, actor, actor_label, via, client_id, reason)
  values (
    tg_table_name,
    case when v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id::uuid end,
    tg_op,
    v_old,
    v_new,
    auth.uid(),
    nullif(current_setting('app.actor', true), ''),
    nullif(current_setting('app.via', true), ''),
    nullif(current_setting('app.client_id', true), ''),
    nullif(current_setting('app.reason', true), '')
  );
  return null;
end;
$$;

-- I1: an issued invoice is a frozen snapshot. Allowed: status forward (payments), void with a
-- reason, and setting generated file ids once. Anything else raises TL001.
create or replace function public.guard_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allowed text[];
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'issued invoices cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if (new.number, new.client_id, new.contract_id, new.period_id, new.issue_date, new.due_date,
        new.currency, new.total, new.snapshot, new.date_override_reason, new.is_legacy)
       is distinct from
       (old.number, old.client_id, old.contract_id, old.period_id, old.issue_date, old.due_date,
        old.currency, old.total, old.snapshot, old.date_override_reason, old.is_legacy) then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'number, dates, amounts and snapshot are frozen';
    end if;
    if (old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
       or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id) then
      raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;
    v_allowed := case old.status
      when 'issued' then array['issued', 'partially_paid', 'paid', 'void', 'written_off']
      when 'partially_paid' then array['partially_paid', 'paid', 'void', 'written_off']
      when 'paid' then array['paid']
      else array[old.status::text]
    end;
    if not new.status::text = any (v_allowed) then
      raise exception 'invoice_status_backwards' using errcode = 'TL002', detail = format('%s → %s', old.status, new.status);
    end if;
  end if;

  -- Leaving draft: snapshot is mandatory except for legacy invoices (spec 8).
  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') then
    if new.snapshot is null and not new.is_legacy then
      raise exception 'invoice_snapshot_required' using errcode = 'TL003';
    end if;
    -- I3: working-day date, unless an owner overrides it with a reason.
    if not new.is_legacy and not public.is_working_day(new.issue_date) then
      if coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner' then
        raise exception 'document_date_not_working_day' using errcode = 'TL004',
          detail = to_char(new.issue_date, 'DD.MM.YYYY');
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_invoice
  before insert or update or delete on public.invoice
  for each row execute function public.guard_invoice();

-- I1: lines of an issued invoice are frozen too.
create or replace function public.guard_invoice_line()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status public.invoice_status;
begin
  select i.status into v_status from public.invoice i where i.id = coalesce(new.invoice_id, old.invoice_id);
  -- Cascade delete of a draft invoice leaves no parent row to check.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'issued_invoice_immutable' using errcode = 'TL001', detail = 'lines of an issued invoice are frozen';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_invoice_line
  before insert or update or delete on public.invoice_line
  for each row execute function public.guard_invoice_line();

-- I6 (hours part): a closed period is read-only.
create or replace function public.guard_timesheet_closed_period()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.period p
    where p.id in (new.period_id, old.period_id) and p.status = 'closed'
  ) then
    raise exception 'period_closed' using errcode = 'TL030';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger guard_closed_period
  before insert or update or delete on public.timesheet
  for each row execute function public.guard_timesheet_closed_period();

-- Reopening a closed period: owner only, with a reason that lands in audit_log (I6).
create or replace function public.guard_period_reopen()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status = 'open' then
    if coalesce(public.current_app_role(), '') <> 'owner'
       and coalesce(current_setting('app.actor', true), '') not like 'system:%' then
      raise exception 'only owner can reopen a period' using errcode = '42501';
    end if;
    if coalesce(trim(current_setting('app.reason', true)), '') = '' then
      raise exception 'period_reopen_reason_required' using errcode = 'TL031';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_period_reopen
  before update on public.period
  for each row execute function public.guard_period_reopen();
