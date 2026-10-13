CREATE TABLE "contractor_invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"contract_id" uuid NOT NULL,
	"payee_id" uuid NOT NULL,
	"payroll_item_id" uuid,
	"number" text,
	"invoice_date" date NOT NULL,
	"period_from" date,
	"period_to" date,
	"hours" numeric(10, 2),
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"description_en" text NOT NULL,
	"description_ua" text NOT NULL,
	"status" "doc_status" DEFAULT 'draft' NOT NULL,
	"snapshot" jsonb,
	"gdoc_file_id" text,
	"pdf_file_id" text,
	"document_id" uuid,
	"void_reason" text,
	CONSTRAINT "contractor_invoice_draft_number_check" CHECK ("contractor_invoice"."status" <> 'draft' or "contractor_invoice"."number" is null),
	CONSTRAINT "contractor_invoice_issued_number_check" CHECK ("contractor_invoice"."status" = 'draft' or "contractor_invoice"."number" is not null),
	CONSTRAINT "contractor_invoice_amount_check" CHECK ("contractor_invoice"."amount" >= 0),
	CONSTRAINT "contractor_invoice_hours_check" CHECK ("contractor_invoice"."hours" is null or "contractor_invoice"."hours" >= 0),
	CONSTRAINT "contractor_invoice_period_check" CHECK ("contractor_invoice"."period_from" is null or "contractor_invoice"."period_to" is null or "contractor_invoice"."period_to" >= "contractor_invoice"."period_from"),
	CONSTRAINT "contractor_invoice_void_reason_check" CHECK ("contractor_invoice"."status" <> 'void' or length(trim(coalesce("contractor_invoice"."void_reason", ''))) > 0),
	CONSTRAINT "contractor_invoice_currency_check" CHECK ("contractor_invoice"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "contractor_invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "address_en" text;--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "bank_details_en" text;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_payroll_item_id_payroll_item_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_invoice_number_key" ON "contractor_invoice" USING btree ("payee_id","number") WHERE "contractor_invoice"."status" <> 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "contractor_invoice_payout_key" ON "contractor_invoice" USING btree ("payroll_item_id") WHERE "contractor_invoice"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "contractor_invoice_payee_idx" ON "contractor_invoice" USING btree ("payee_id");--> statement-breakpoint
CREATE POLICY "contractor_invoice_select" ON "contractor_invoice" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contractor_invoice_insert" ON "contractor_invoice" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contractor_invoice_update" ON "contractor_invoice" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contractor_invoice_delete" ON "contractor_invoice" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));