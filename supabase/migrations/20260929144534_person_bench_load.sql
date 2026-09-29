-- Bench status (spec 6.2) needs FTE of active client assignments, but viewers cannot read
-- `assignment` (4.4). This exposes only the aggregate load per person, to any active app_user.
create or replace function public.person_bench_load(p_on date)
returns table (person_id uuid, load numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.current_app_role() is null then
    return;
  end if;
  return query
    select a.person_id, sum(a.fte)::numeric
    from public.assignment a
    where not a.is_internal
      and a.starts_on <= p_on
      and (a.ends_on is null or a.ends_on >= p_on)
    group by a.person_id;
end;
$$;

revoke all on function public.person_bench_load(date) from public, anon;
grant execute on function public.person_bench_load(date) to authenticated, service_role;
