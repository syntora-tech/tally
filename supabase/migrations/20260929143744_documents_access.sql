select public.setup_app_table('public.document');
select public.setup_app_table('public.document_link');

-- Folder cache is written by the storage layer in system scope only.
revoke all on public.drive_folder from anon, authenticated;
grant all on public.drive_folder to service_role;
