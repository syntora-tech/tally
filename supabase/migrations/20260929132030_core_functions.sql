-- Core helpers shared by all business tables. plpgsql bodies resolve tables at call time,
-- so these can be created before the tables they read.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Role comes from app_user, never from the JWT (spec 2.1, 4.4). Inactive users have no role.
create or replace function public.current_app_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return (
    select u.role::text
    from public.app_user u
    where u.id = auth.uid() and u.is_active
  );
end;
$$;

revoke all on function public.current_app_role() from public, anon;
grant execute on function public.current_app_role() to authenticated, service_role;

-- I8: generic audit trigger. actor = auth.uid() (null for Studio/direct SQL); system jobs and the
-- MCP layer identify themselves via `set local app.actor / app.via / app.client_id`.
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

  insert into public.audit_log (table_name, row_id, action, old, new, actor, actor_label, via, client_id)
  values (
    tg_table_name,
    -- Tables with non-uuid keys keep the key inside old/new only.
    case when v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_id::uuid end,
    tg_op,
    v_old,
    v_new,
    auth.uid(),
    nullif(current_setting('app.actor', true), ''),
    nullif(current_setting('app.via', true), ''),
    nullif(current_setting('app.client_id', true), '')
  );
  return null;
end;
$$;

revoke all on function public.audit_row_change() from public, anon, authenticated;

-- Attaches the standard updated_at + audit triggers to a business table.
create or replace function public.enable_standard_triggers(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format(
    'create trigger set_updated_at before update on %s for each row execute function public.set_updated_at()',
    p_table
  );
  execute format(
    'create trigger audit_row_change after insert or update or delete on %s for each row execute function public.audit_row_change()',
    p_table
  );
end;
$$;

revoke all on function public.enable_standard_triggers(regclass) from public, anon, authenticated;
