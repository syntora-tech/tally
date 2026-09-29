-- Grants are explicit (auto_expose_new_tables = false); anon never reads app data.

select public.enable_standard_triggers('public.app_user');

grant select, insert, update, delete on public.app_user to authenticated;
grant all on public.app_user to service_role;

-- audit_log is append-only through the trigger; users may only read (RLS narrows to owner/finance).
grant select on public.audit_log to authenticated;
grant select on public.audit_log to service_role;

revoke all on public.app_user, public.audit_log from anon;
