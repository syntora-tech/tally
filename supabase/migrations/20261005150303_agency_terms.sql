CREATE TYPE "public"."payroll_item_kind" AS ENUM('person', 'agency');--> statement-breakpoint
CREATE TABLE "agency_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"assignment_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"payee_id" uuid NOT NULL,
	"rate_per_hour" numeric(20, 8) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payout_method" "payout_method" DEFAULT 'fiat' NOT NULL,
	"release_policy" "release_policy" DEFAULT 'on_payment_or_due' NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agency_terms_version_key" UNIQUE("assignment_id","valid_from"),
	CONSTRAINT "agency_terms_valid_from_check" CHECK (extract(day from valid_from) = 1),
	CONSTRAINT "agency_terms_rate_check" CHECK ("agency_terms"."rate_per_hour" >= 0),
	CONSTRAINT "agency_terms_grace_days_check" CHECK ("agency_terms"."grace_days" >= 0),
	CONSTRAINT "agency_terms_currency_check" CHECK ("agency_terms"."currency" = 'USD')
);
--> statement-breakpoint
ALTER TABLE "agency_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_item" DROP CONSTRAINT "payroll_item_key";--> statement-breakpoint
ALTER TABLE "payroll_line" DROP CONSTRAINT "payroll_line_timesheet_key";--> statement-breakpoint
ALTER TABLE "payroll_item" ALTER COLUMN "person_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_item" ADD COLUMN "kind" "payroll_item_kind" DEFAULT 'person' NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD COLUMN "agency_fee" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_terms" ADD CONSTRAINT "agency_terms_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_terms" ADD CONSTRAINT "agency_terms_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agency_terms_payee_idx" ON "agency_terms" USING btree ("payee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_item_person_key" ON "payroll_item" USING btree ("period_id","person_id","payout_method") WHERE "payroll_item"."kind" = 'person';--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_item_agency_key" ON "payroll_item" USING btree ("period_id","payee_id","payout_method") WHERE "payroll_item"."kind" = 'agency';--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_timesheet_key" UNIQUE("timesheet_id","agency_fee");--> statement-breakpoint
ALTER TABLE "payroll_item" ADD CONSTRAINT "payroll_item_kind_check" CHECK (("payroll_item"."kind" = 'person') = ("payroll_item"."person_id" is not null) and ("payroll_item"."kind" = 'person' or "payroll_item"."payee_id" is not null));--> statement-breakpoint
CREATE POLICY "agency_terms_select" ON "agency_terms" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "agency_terms_insert" ON "agency_terms" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "agency_terms_update" ON "agency_terms" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "agency_terms_delete" ON "agency_terms" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));