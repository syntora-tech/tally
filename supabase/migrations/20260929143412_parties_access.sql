-- Standard wiring for every business table: explicit grants (auto_expose_new_tables = false),
-- no anon access, updated_at and audit triggers. RLS policies come from the Drizzle schema.
create or replace function public.setup_app_table(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('grant select, insert, update, delete on %s to authenticated', p_table);
  execute format('grant all on %s to service_role', p_table);
  execute format('revoke all on %s from anon', p_table);
  perform public.enable_standard_triggers(p_table);
end;
$$;

revoke all on function public.setup_app_table(regclass) from public, anon, authenticated;

select public.setup_app_table('public.company');
select public.setup_app_table('public.person');
select public.setup_app_table('public.payee');
select public.setup_app_table('public.client');
