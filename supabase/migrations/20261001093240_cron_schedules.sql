-- Background jobs (spec 10.4): pg_cron → pg_net → POST /api/cron/<name>.
-- The target URL and the shared secret are per environment and live in Supabase Vault
-- (`tally_app_url`, `tally_cron_secret`, see docs/deployment.md). Without them the call is a
-- no-op, so local stacks and fresh projects stay quiet until configured.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.call_cron(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'tally_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'tally_cron_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;
  return net.http_post(
    url := rtrim(v_url, '/') || '/api/cron/' || p_name,
    headers := jsonb_build_object('authorization', 'Bearer ' || v_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function public.call_cron(text) from public, anon, authenticated;

-- pg_cron runs in UTC; Kyiv times from 10.4 use the summer offset (UTC+3), an hour later in winter.
select cron.schedule('tally-jobs', '* * * * *', $$select public.call_cron('jobs')$$);
select cron.schedule('tally-nbu-rates', '0 7 * * *', $$select public.call_cron('nbu-rates')$$);
select cron.schedule('tally-payability', '0 3 * * *', $$select public.call_cron('payability')$$);
