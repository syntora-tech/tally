select public.setup_app_table('public.mcp_client_policy');

-- Call log and idempotency are operational: the MCP handler writes them with the system
-- connection; the owner only reads the call log (Settings → «Підключені агенти»).
grant select on public.mcp_call_log to authenticated;
grant all on public.mcp_call_log to service_role;
revoke all on public.mcp_call_log from anon;

grant all on public.mcp_idempotency to service_role;
revoke all on public.mcp_idempotency from anon, authenticated;
