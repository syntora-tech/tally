CREATE TYPE "public"."adjustment_kind" AS ENUM('bonus', 'deduction', 'trip_reimbursement', 'correction', 'other');--> statement-breakpoint
CREATE TYPE "public"."funding_source" AS ENUM('client', 'company');--> statement-breakpoint
CREATE TYPE "public"."payroll_item_status" AS ENUM('draft', 'partially_payable', 'payable', 'partially_paid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."payroll_line_status" AS ENUM('accrued', 'awaiting_client', 'payable', 'paid');--> statement-breakpoint
CREATE TABLE "adjustment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"period_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"payout_method" "payout_method" DEFAULT 'fiat' NOT NULL,
	"kind" "adjustment_kind" NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"reason" text NOT NULL,
	CONSTRAINT "adjustment_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "adjustment_amount_check" CHECK ("adjustment"."amount" <> 0),
	CONSTRAINT "adjustment_reason_check" CHECK (length(trim("adjustment"."reason")) > 0),
	CONSTRAINT "adjustment_currency_check" CHECK ("adjustment"."currency" in ('USD', 'USDT', 'USDC', 'UAH')),
	CONSTRAINT "adjustment_currency_format_check" CHECK ("adjustment"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "adjustment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"period_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"payout_method" "payout_method" NOT NULL,
	"payee_id" uuid,
	"status" "payroll_item_status" DEFAULT 'draft' NOT NULL,
	"total_usd" numeric(20, 8) DEFAULT '0' NOT NULL,
	"payout_fx_rate" numeric(18, 6),
	"fx_source" "fx_source",
	"fx_set_by" uuid,
	"fx_set_at" timestamp with time zone,
	"total_uah" numeric(20, 2),
	"paid_amount" numeric(20, 8) DEFAULT '0' NOT NULL,
	CONSTRAINT "payroll_item_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "payroll_item_key" UNIQUE("period_id","person_id","payout_method"),
	CONSTRAINT "payroll_item_fx_check" CHECK (("payroll_item"."payout_fx_rate" is null) = ("payroll_item"."total_uah" is null) and ("payroll_item"."payout_fx_rate" is null) = ("payroll_item"."fx_source" is null))
);
--> statement-breakpoint
ALTER TABLE "payroll_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_line" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"payroll_item_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"timesheet_id" uuid,
	"amount_usd" numeric(20, 8) NOT NULL,
	"funded_by_invoice_line_id" uuid,
	"funding_source" "funding_source",
	"status" "payroll_line_status" DEFAULT 'accrued' NOT NULL,
	"payable_at" timestamp with time zone,
	"override_reason" text,
	CONSTRAINT "payroll_line_timesheet_key" UNIQUE("timesheet_id"),
	CONSTRAINT "payroll_line_assignment_key" UNIQUE("payroll_item_id","assignment_id"),
	CONSTRAINT "payroll_line_payable_check" CHECK ("payroll_line"."status" in ('accrued', 'awaiting_client') or "payroll_line"."funding_source" is not null)
);
--> statement-breakpoint
ALTER TABLE "payroll_line" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation" DROP CONSTRAINT "allocation_target_check";--> statement-breakpoint
ALTER TABLE "allocation" ADD COLUMN "payroll_item_id" uuid;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item" ADD CONSTRAINT "payroll_item_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item" ADD CONSTRAINT "payroll_item_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_item" ADD CONSTRAINT "payroll_item_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_payroll_item_id_payroll_item_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_timesheet_id_timesheet_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheet"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_funded_by_invoice_line_id_invoice_line_id_fk" FOREIGN KEY ("funded_by_invoice_line_id") REFERENCES "public"."invoice_line"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_period_person_idx" ON "adjustment" USING btree ("period_id","person_id");--> statement-breakpoint
CREATE INDEX "payroll_item_period_idx" ON "payroll_item" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "payroll_line_funded_by_idx" ON "payroll_line" USING btree ("funded_by_invoice_line_id");--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_payroll_item_id_payroll_item_id_fk" FOREIGN KEY ("payroll_item_id") REFERENCES "public"."payroll_item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_payroll_item_idx" ON "allocation" USING btree ("payroll_item_id");--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_target_check" CHECK (num_nonnulls("allocation"."invoice_id", "allocation"."payroll_item_id") = 1);--> statement-breakpoint
CREATE POLICY "adjustment_select" ON "adjustment" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "adjustment_insert" ON "adjustment" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "adjustment_update" ON "adjustment" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "adjustment_delete" ON "adjustment" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_item_select" ON "payroll_item" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_item_insert" ON "payroll_item" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_item_update" ON "payroll_item" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_item_delete" ON "payroll_item" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_line_select" ON "payroll_line" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_line_insert" ON "payroll_line" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_line_update" ON "payroll_line" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payroll_line_delete" ON "payroll_line" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));