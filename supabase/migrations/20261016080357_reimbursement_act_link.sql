-- A-108: the act link moves to the reimbursement, so several reimbursements can share one act.
ALTER TABLE "reimbursement" ADD COLUMN "supplier_act_id" uuid;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_supplier_act_id_supplier_act_id_fk" FOREIGN KEY ("supplier_act_id") REFERENCES "public"."supplier_act"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reimbursement_supplier_act_idx" ON "reimbursement" USING btree ("supplier_act_id");--> statement-breakpoint
UPDATE "reimbursement" r SET "supplier_act_id" = a."id" FROM "supplier_act" a WHERE a."reimbursement_id" = r."id";--> statement-breakpoint
create or replace function public.guard_supplier_act()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract public.contract;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'issued acts cannot be deleted';
    end if;
    return old;
  end if;

  select * into v_contract from public.contract c where c.id = new.contract_id;
  if v_contract.kind <> 'fop' or v_contract.payee_id is distinct from new.payee_id then
    raise exception 'act_contract_mismatch' using errcode = 'TL060';
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    -- A legacy act's type was guessed by the import (A-052); the trips import may correct it.
    if (new.contract_id, new.payee_id, new.number, new.act_date,
        new.period_from, new.period_to, new.amount_uah, new.snapshot, new.date_override_reason, new.is_legacy,
        new.fx_rate, new.fx_source, new.amount_usd, new.assignment_ids)
       is distinct from
       (old.contract_id, old.payee_id, old.number, old.act_date,
        old.period_from, old.period_to, old.amount_uah, old.snapshot, old.date_override_reason, old.is_legacy,
        old.fx_rate, old.fx_source, old.amount_usd, old.assignment_ids)
       or (new.type is distinct from old.type and not old.is_legacy) then
      raise exception 'issued_act_immutable' using errcode = 'TL001';
    end if;
    if old.payroll_item_id is not null and new.payroll_item_id is distinct from old.payroll_item_id then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'the payout is set once';
    end if;
    if (old.gdoc_file_id is not null and new.gdoc_file_id is distinct from old.gdoc_file_id)
       or (old.pdf_file_id is not null and new.pdf_file_id is distinct from old.pdf_file_id) then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'generated files are set once';
    end if;
    if not (new.status = old.status or (old.status = 'issued' and new.status = 'void')) then
      raise exception 'act_status_backwards' using errcode = 'TL002', detail = format('%s → %s', old.status, new.status);
    end if;
  end if;

  if new.status <> 'draft' and (tg_op = 'INSERT' or old.status = 'draft') and not new.is_legacy then
    if new.snapshot is null then
      raise exception 'act_snapshot_required' using errcode = 'TL003';
    end if;
    if not public.is_working_day(new.act_date)
       and (coalesce(trim(new.date_override_reason), '') = '' or coalesce(public.current_app_role(), '') <> 'owner') then
      raise exception 'document_date_not_working_day' using errcode = 'TL004',
        detail = to_char(new.act_date, 'DD.MM.YYYY');
    end if;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
ALTER TABLE "supplier_act" DROP CONSTRAINT "supplier_act_reimbursement_id_reimbursement_id_fk";--> statement-breakpoint
ALTER TABLE "supplier_act" DROP COLUMN "reimbursement_id";--> statement-breakpoint
-- The act of a reimbursement belongs to its payee, and an issued act keeps its reimbursements
-- (as the act kept its reimbursement before).
create or replace function public.guard_reimbursement_act()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_old public.supplier_act;
  v_new public.supplier_act;
begin
  if new.supplier_act_id is not distinct from old.supplier_act_id then
    return new;
  end if;
  if old.supplier_act_id is not null then
    select * into v_old from public.supplier_act a where a.id = old.supplier_act_id;
    if found and v_old.status <> 'draft' then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'the reimbursement of an issued act is set once';
    end if;
  end if;
  if new.supplier_act_id is not null then
    select * into v_new from public.supplier_act a where a.id = new.supplier_act_id;
    if v_new.payee_id is distinct from new.payee_id then
      raise exception 'act_contract_mismatch' using errcode = 'TL060', detail = 'the act of a reimbursement is its payee''s';
    end if;
    if v_new.status <> 'draft' and not v_new.is_legacy then
      raise exception 'issued_act_immutable' using errcode = 'TL001', detail = 'an issued act takes no more reimbursements';
    end if;
  end if;
  return new;
end;
$$;--> statement-breakpoint
create trigger guard_reimbursement_act
  before update of supplier_act_id on public.reimbursement
  for each row execute function public.guard_reimbursement_act();
