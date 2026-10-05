CREATE TABLE "reimbursement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"payee_id" uuid,
	"amount" numeric(20, 2) NOT NULL,
	"currency" text DEFAULT 'UAH' NOT NULL,
	"method" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"adjustment_id" uuid,
	"notes" text,
	CONSTRAINT "reimbursement_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "reimbursement_amount_check" CHECK ("reimbursement"."amount" > 0),
	CONSTRAINT "reimbursement_currency_check" CHECK ("reimbursement"."currency" = 'UAH'),
	CONSTRAINT "reimbursement_method_check" CHECK ("reimbursement"."method" in ('payroll', 'act', 'direct_payment')),
	CONSTRAINT "reimbursement_status_check" CHECK ("reimbursement"."status" in ('planned', 'paid')),
	CONSTRAINT "reimbursement_payee_check" CHECK ("reimbursement"."method" <> 'act' or "reimbursement"."payee_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "reimbursement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"title" text NOT NULL,
	"location" text,
	"starts_on" date,
	"ends_on" date,
	"notes" text,
	CONSTRAINT "trip_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "trip_title_check" CHECK (length(trim("trip"."title")) > 0),
	CONSTRAINT "trip_dates_check" CHECK (("trip"."legacy_ref" is not null or ("trip"."starts_on" is not null and "trip"."ends_on" is not null)) and ("trip"."ends_on" is null or "trip"."starts_on" is null or "trip"."ends_on" >= "trip"."starts_on"))
);
--> statement-breakpoint
ALTER TABLE "trip" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"spent_on" date,
	"description" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate" numeric(18, 6) NOT NULL,
	"fx_source" "fx_source" DEFAULT 'nbu' NOT NULL,
	"amount_uah" numeric(20, 2) NOT NULL,
	"amount_usd" numeric(20, 8) NOT NULL,
	"reimbursable" boolean DEFAULT true NOT NULL,
	"paid_by" text DEFAULT 'person' NOT NULL,
	"receipt_document_id" uuid,
	"transaction_id" uuid,
	CONSTRAINT "trip_expense_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "trip_expense_amount_check" CHECK ("trip_expense"."amount" > 0 and "trip_expense"."fx_rate" > 0),
	CONSTRAINT "trip_expense_paid_by_check" CHECK ("trip_expense"."paid_by" in ('person', 'company')),
	CONSTRAINT "trip_expense_company_check" CHECK ("trip_expense"."paid_by" = 'person' or not "trip_expense"."reimbursable"),
	CONSTRAINT "trip_expense_spent_on_check" CHECK ("trip_expense"."spent_on" is not null or "trip_expense"."legacy_ref" is not null),
	CONSTRAINT "trip_expense_description_check" CHECK (length(trim("trip_expense"."description")) > 0),
	CONSTRAINT "trip_expense_currency_check" CHECK ("trip_expense"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "trip_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trip_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"trip_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	CONSTRAINT "trip_participant_key" UNIQUE("trip_id","person_id")
);
--> statement-breakpoint
ALTER TABLE "trip_participant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document" DROP CONSTRAINT "document_type_check";--> statement-breakpoint
ALTER TABLE "allocation" DROP CONSTRAINT "allocation_target_check";--> statement-breakpoint
ALTER TABLE "allocation" ADD COLUMN "reimbursement_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD COLUMN "reimbursement_id" uuid;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_adjustment_id_adjustment_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."adjustment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursement" ADD CONSTRAINT "reimbursement_participant_fk" FOREIGN KEY ("trip_id","person_id") REFERENCES "public"."trip_participant"("trip_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expense" ADD CONSTRAINT "trip_expense_receipt_document_id_document_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expense" ADD CONSTRAINT "trip_expense_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_expense" ADD CONSTRAINT "trip_expense_participant_fk" FOREIGN KEY ("trip_id","person_id") REFERENCES "public"."trip_participant"("trip_id","person_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_participant" ADD CONSTRAINT "trip_participant_trip_id_trip_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trip"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_participant" ADD CONSTRAINT "trip_participant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reimbursement_trip_idx" ON "reimbursement" USING btree ("trip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_expense_transaction_key" ON "trip_expense" USING btree ("transaction_id") WHERE "trip_expense"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX "trip_expense_trip_idx" ON "trip_expense" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "trip_participant_person_idx" ON "trip_participant" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_reimbursement_id_reimbursement_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."reimbursement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD CONSTRAINT "supplier_act_reimbursement_id_reimbursement_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."reimbursement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_reimbursement_idx" ON "allocation" USING btree ("reimbursement_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_type_check" CHECK ("document"."type" in ('contract', 'sow', 'annex', 'invoice', 'act', 'cv', 'nda', 'statement', 'receipt', 'other'));--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_target_check" CHECK (num_nonnulls("allocation"."invoice_id", "allocation"."payroll_item_id", "allocation"."reimbursement_id") = 1);--> statement-breakpoint
CREATE POLICY "reimbursement_select" ON "reimbursement" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "reimbursement_insert" ON "reimbursement" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "reimbursement_update" ON "reimbursement" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "reimbursement_delete" ON "reimbursement" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_select" ON "trip" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "trip_insert" ON "trip" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_update" ON "trip" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_delete" ON "trip" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_expense_select" ON "trip_expense" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_expense_insert" ON "trip_expense" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_expense_update" ON "trip_expense" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_expense_delete" ON "trip_expense" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_participant_select" ON "trip_participant" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "trip_participant_insert" ON "trip_participant" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_participant_update" ON "trip_participant" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "trip_participant_delete" ON "trip_participant" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));