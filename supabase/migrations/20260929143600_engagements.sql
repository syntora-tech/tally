CREATE TYPE "public"."billing_type" AS ENUM('fixed_monthly', 'hourly', 'none');--> statement-breakpoint
CREATE TYPE "public"."pay_type" AS ENUM('fixed', 'hourly', 'included');--> statement-breakpoint
CREATE TYPE "public"."payout_method" AS ENUM('fiat', 'crypto');--> statement-breakpoint
CREATE TYPE "public"."period_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "public"."proration_policy" AS ENUM('full_month', 'by_hours', 'trunc_hourly');--> statement-breakpoint
CREATE TYPE "public"."release_policy" AS ENUM('immediate', 'on_payment_or_due');--> statement-breakpoint
CREATE TABLE "assignment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"person_id" uuid NOT NULL,
	"contract_id" uuid,
	"is_internal" boolean DEFAULT false NOT NULL,
	"sow_ref" text,
	"role_title" text,
	"fte" numeric(4, 2) DEFAULT '1' NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date,
	CONSTRAINT "assignment_contract_check" CHECK ("assignment"."is_internal" or "assignment"."contract_id" is not null),
	CONSTRAINT "assignment_fte_check" CHECK ("assignment"."fte" > 0 and "assignment"."fte" <= 1),
	CONSTRAINT "assignment_dates_check" CHECK ("assignment"."ends_on" is null or "assignment"."ends_on" >= "assignment"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "assignment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"assignment_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"type" "billing_type" NOT NULL,
	"rate" numeric(20, 8) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"proration_policy" "proration_policy" DEFAULT 'full_month' NOT NULL,
	"invoice_channel" "payout_method" DEFAULT 'fiat' NOT NULL,
	CONSTRAINT "billing_terms_version_key" UNIQUE("assignment_id","valid_from"),
	CONSTRAINT "billing_terms_valid_from_check" CHECK (extract(day from valid_from) = 1),
	CONSTRAINT "billing_terms_rate_check" CHECK ("billing_terms"."rate" >= 0),
	CONSTRAINT "billing_terms_currency_check" CHECK ("billing_terms"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "billing_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contract" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"signed_on" date,
	"company_id" uuid NOT NULL,
	"client_id" uuid,
	"payee_id" uuid,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_due_rule" jsonb DEFAULT '{"type":"day_of_month","day":20}'::jsonb NOT NULL,
	"invoice_date_rule" jsonb DEFAULT '{"type":"first_working_day_after_period"}'::jsonb NOT NULL,
	"act_date_rule" jsonb DEFAULT '{"type":"last_working_day_of_period"}'::jsonb NOT NULL,
	"invoice_template_file_id" text,
	"act_template_file_id" text,
	"number_sequence_key" text,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "contract_kind_check" CHECK ("contract"."kind" in ('client', 'fop')),
	CONSTRAINT "contract_one_counterparty_check" CHECK (num_nonnulls("contract"."client_id", "contract"."payee_id") = 1 and ("contract"."kind" = 'client') = ("contract"."client_id" is not null)),
	CONSTRAINT "contract_status_check" CHECK ("contract"."status" in ('active', 'ended')),
	CONSTRAINT "contract_payment_due_rule_check" CHECK ("contract"."payment_due_rule" ->> 'type' in ('day_of_month', 'net_days')),
	CONSTRAINT "contract_invoice_date_rule_check" CHECK ("contract"."invoice_date_rule" ->> 'type' in ('first_working_day_after_period', 'nth_working_day_after_period')),
	CONSTRAINT "contract_act_date_rule_check" CHECK ("contract"."act_date_rule" ->> 'type' in ('last_working_day_of_period', 'nth_working_day_after_period', 'manual')),
	CONSTRAINT "contract_currency_check" CHECK ("contract"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "contract" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"assignment_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"type" "pay_type" NOT NULL,
	"amount" numeric(20, 8) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payout_method" "payout_method" DEFAULT 'fiat' NOT NULL,
	"release_policy" "release_policy" DEFAULT 'on_payment_or_due' NOT NULL,
	"grace_days" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pay_terms_version_key" UNIQUE("assignment_id","valid_from"),
	CONSTRAINT "pay_terms_valid_from_check" CHECK (extract(day from valid_from) = 1),
	CONSTRAINT "pay_terms_amount_check" CHECK ("pay_terms"."amount" >= 0),
	CONSTRAINT "pay_terms_grace_days_check" CHECK ("pay_terms"."grace_days" >= 0),
	CONSTRAINT "pay_terms_currency_check" CHECK ("pay_terms"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "pay_terms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "period" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"month" date NOT NULL,
	"work_hours" numeric(6, 2) NOT NULL,
	"status" "period_status" DEFAULT 'open' NOT NULL,
	"reference_fx_usd_uah" numeric(18, 6),
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	CONSTRAINT "period_month_unique" UNIQUE("month"),
	CONSTRAINT "period_month_check" CHECK (extract(day from month) = 1),
	CONSTRAINT "period_work_hours_check" CHECK ("period"."work_hours" > 0)
);
--> statement-breakpoint
ALTER TABLE "period" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_terms" ADD CONSTRAINT "billing_terms_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_payee_id_payee_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payee"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_terms" ADD CONSTRAINT "pay_terms_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_person_idx" ON "assignment" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "assignment_contract_idx" ON "assignment" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "contract_client_idx" ON "contract" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "contract_payee_idx" ON "contract" USING btree ("payee_id");--> statement-breakpoint
CREATE POLICY "assignment_select" ON "assignment" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "assignment_insert" ON "assignment" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "assignment_update" ON "assignment" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "assignment_delete" ON "assignment" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "billing_terms_select" ON "billing_terms" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "billing_terms_insert" ON "billing_terms" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "billing_terms_update" ON "billing_terms" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "billing_terms_delete" ON "billing_terms" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_select" ON "contract" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_insert" ON "contract" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_update" ON "contract" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_delete" ON "contract" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "pay_terms_select" ON "pay_terms" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "pay_terms_insert" ON "pay_terms" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "pay_terms_update" ON "pay_terms" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "pay_terms_delete" ON "pay_terms" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "period_select" ON "period" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "period_insert" ON "period" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "period_update" ON "period" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "period_delete" ON "period" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));