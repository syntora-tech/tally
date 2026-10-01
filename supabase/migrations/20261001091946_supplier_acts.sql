CREATE TYPE "public"."act_type" AS ENUM('monthly', 'reimbursement', 'other');--> statement-breakpoint
CREATE TABLE "supplier_act" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"is_legacy" boolean DEFAULT false NOT NULL,
	"contract_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"payroll_item_id" uuid,
	"type" "act_type" DEFAULT 'monthly' NOT NULL,
	"number" text,
	"act_date" date NOT NULL,
	"period_from" date,
	"period_to" date,
	"amount_uah" numeric(20, 2) NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb,
	"gdoc_file_id" text,
	"pdf_file_id" text,
	"signed_url" text,
	"date_override_reason" text,
	"void_reason" text,
	CONSTRAINT "supplier_act_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "supplier_act_draft_number_check" CHECK ("supplier_act"."status" <> 'draft' or "supplier_act"."number" is null),
	CONSTRAINT "supplier_act_issued_number_check" CHECK ("supplier_act"."status" = 'draft' or "supplier_act"."number" is not null),
	CONSTRAINT "supplier_act_amount_check" CHECK ("supplier_act"."amount_uah" >= 0),
	CONSTRAINT "supplier_act_period_check" CHECK ("supplier_act"."period_from" is null or "supplier_act"."period_to" is null or "supplier_act"."period_to" >= "supplier_act"."period_from"),
	CONSTRAINT "supplier_act_void_reason_check" CHECK ("supplier_act"."status" <> 'void' or length(trim(coalesce("supplier_act"."void_reason", ''))) > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_act" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD CONSTRAINT "supplier_act_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD CONSTRAINT "supplier_act_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD CONSTRAINT "supplier_act_payroll_item_id_payroll_item_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_act_number_key" ON "supplier_act" USING btree ("contract_id","number") WHERE "supplier_act"."status" <> 'draft';--> statement-breakpoint
CREATE INDEX "supplier_act_payee_idx" ON "supplier_act" USING btree ("payee_id");--> statement-breakpoint
CREATE INDEX "supplier_act_payroll_item_idx" ON "supplier_act" USING btree ("payroll_item_id");--> statement-breakpoint
CREATE POLICY "supplier_act_select" ON "supplier_act" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "supplier_act_insert" ON "supplier_act" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "supplier_act_update" ON "supplier_act" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "supplier_act_delete" ON "supplier_act" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));