CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'partially_paid', 'paid', 'void', 'written_off');--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"is_legacy" boolean DEFAULT false NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"period_id" uuid,
	"number" text,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"total" numeric(20, 8) DEFAULT '0' NOT NULL,
	"paid_amount" numeric(20, 8) DEFAULT '0' NOT NULL,
	"snapshot" jsonb,
	"gdoc_file_id" text,
	"pdf_file_id" text,
	"date_override_reason" text,
	"void_reason" text,
	CONSTRAINT "invoice_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "invoice_draft_number_check" CHECK ("invoice"."status" <> 'draft' or "invoice"."number" is null),
	CONSTRAINT "invoice_issued_number_check" CHECK ("invoice"."status" = 'draft' or "invoice"."number" is not null),
	CONSTRAINT "invoice_void_reason_check" CHECK ("invoice"."status" <> 'void' or length(trim(coalesce("invoice"."void_reason", ''))) > 0),
	CONSTRAINT "invoice_amounts_check" CHECK ("invoice"."total" >= 0 and "invoice"."paid_amount" >= 0),
	CONSTRAINT "invoice_due_check" CHECK ("invoice"."due_date" >= "invoice"."issue_date"),
	CONSTRAINT "invoice_currency_check" CHECK ("invoice"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"invoice_id" uuid NOT NULL,
	"timesheet_id" uuid,
	"position" integer NOT NULL,
	"description_en" text NOT NULL,
	"description_ua" text NOT NULL,
	"quantity" numeric(10, 2) NOT NULL,
	"unit_price" numeric(20, 8) NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	CONSTRAINT "invoice_line_timesheet_key" UNIQUE("timesheet_id"),
	CONSTRAINT "invoice_line_position_key" UNIQUE("invoice_id","position"),
	CONSTRAINT "invoice_line_amounts_check" CHECK ("invoice_line"."quantity" >= 0 and "invoice_line"."unit_price" >= 0 and "invoice_line"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_timesheet_id_timesheet_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice" USING btree ("number") WHERE "invoice"."status" <> 'draft';--> statement-breakpoint
CREATE INDEX "invoice_client_idx" ON "invoice" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "invoice_period_idx" ON "invoice" USING btree ("period_id");--> statement-breakpoint
CREATE POLICY "invoice_select" ON "invoice" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_insert" ON "invoice" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_update" ON "invoice" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_delete" ON "invoice" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_line_select" ON "invoice_line" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_line_insert" ON "invoice_line" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_line_update" ON "invoice_line" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "invoice_line_delete" ON "invoice_line" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));