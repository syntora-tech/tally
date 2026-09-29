-- Local seed. app_user rows are not seeded: the first sign-in of an ALLOWED_EMAILS address
-- creates the owner (docs/assumptions.md A-005). Company requisites come from Settings or the
-- legacy import; categories arrive with the ledger (stage 3).

-- Number sequences continue after the real numbers (spec 5.6, Q3: invoices from 25/26).
insert into public.number_sequence (key, template, next_value, year_scoped, current_year) values
  ('invoice', '{seq}/{yy}', 25, true, 2026),
  ('act:OD-1001', '1001 - А{seq}', 13, false, null),
  ('act:OD-1002', '1002 - А{seq}', 10, false, null),
  ('act:OD-1003', '1003 - А{seq}', 11, false, null),
  ('act:MF281025', 'MF281025/{seq}', 11, false, null)
on conflict (key) do nothing;
