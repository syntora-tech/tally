-- invoice_revision is append-only and not writable by app roles; the guard records revisions as
-- the table owner. Role checks inside still read the caller's JWT via current_app_role().
alter function public.guard_invoice() security definer;
revoke all on function public.guard_invoice() from public, anon, authenticated;
