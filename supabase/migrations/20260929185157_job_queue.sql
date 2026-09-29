-- Queue rows are operational, not business data: no audit trigger, only updated_at.
grant select, insert, update, delete on public.job to authenticated;
grant all on public.job to service_role;
revoke all on public.job from anon;

create trigger set_updated_at before update on public.job
  for each row execute function public.set_updated_at();

-- Takes the next due job for one worker call (spec 10.4). Jobs left `running` by a crashed or
-- timed-out call go back to the queue after 10 minutes; SKIP LOCKED keeps parallel calls apart.
create or replace function public.claim_job()
returns setof public.job
language plpgsql
set search_path = ''
as $$
begin
  update public.job
     set status = 'queued', last_error = coalesce(last_error, 'worker timed out')
   where status = 'running' and started_at < now() - interval '10 minutes';

  return query
  update public.job j
     set status = 'running', attempts = j.attempts + 1, started_at = now(), finished_at = null
   where j.id = (
     select q.id from public.job q
      where q.status = 'queued' and q.run_after <= now()
      order by q.run_after, q.created_at
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;

revoke all on function public.claim_job() from public, anon, authenticated;
grant execute on function public.claim_job() to service_role;
