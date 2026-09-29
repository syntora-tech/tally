CREATE TABLE "client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legal_name" text NOT NULL,
	"short_name" text,
	"address" text,
	"country" text,
	"bank_details" text,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_currency" text DEFAULT 'USD' NOT NULL,
	"zoho_id" text,
	CONSTRAINT "client_default_currency_check" CHECK ("client"."default_currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "client" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "company" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"name_en" text NOT NULL,
	"name_ua" text NOT NULL,
	"legal_code" text,
	"address_en" text,
	"address_ua" text,
	"director_ua" text,
	"director_en" text,
	"bank_details_en" text,
	"bank_details_ua" text
);
--> statement-breakpoint
ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payee" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"kind" text NOT NULL,
	"legal_name_ua" text,
	"legal_name_en" text,
	"tax_id" text,
	"edr_record" text,
	"edr_date" date,
	"address_ua" text,
	"iban" text,
	"bank_name" text,
	"wallet_address" text,
	"wallet_network" text,
	"person_id" uuid,
	CONSTRAINT "payee_kind_check" CHECK ("payee"."kind" in ('fop', 'crypto', 'other')),
	CONSTRAINT "payee_name_check" CHECK (num_nonnulls("payee"."legal_name_ua", "payee"."legal_name_en") >= 1)
);
--> statement-breakpoint
ALTER TABLE "payee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"full_name" text NOT NULL,
	"display_name" text,
	"position" text,
	"seniority" text[] DEFAULT '{}' NOT NULL,
	"stack" text[] DEFAULT '{}' NOT NULL,
	"domains" text[] DEFAULT '{}' NOT NULL,
	"market_rate_usd" numeric(20, 8),
	"allocation" text,
	"availability_from" date,
	"location" text,
	"timezone" text,
	"contact_owner" text,
	"status" text DEFAULT 'active' NOT NULL,
	"default_payee_id" uuid,
	"notes" text,
	CONSTRAINT "person_allocation_check" CHECK ("person"."allocation" in ('full_time', 'part_time')),
	CONSTRAINT "person_status_check" CHECK ("person"."status" in ('active', 'bench', 'inactive')),
	CONSTRAINT "person_market_rate_check" CHECK ("person"."market_rate_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_default_payee_id_payee_id_fk" FOREIGN KEY ("default_payee_id") REFERENCES "public"."payee"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_zoho_id_key" ON "client" USING btree ("zoho_id") WHERE "client"."zoho_id" is not null;--> statement-breakpoint
CREATE INDEX "person_stack_idx" ON "person" USING gin ("stack");--> statement-breakpoint
CREATE POLICY "client_select" ON "client" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "client_insert" ON "client" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "client_update" ON "client" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "client_delete" ON "client" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "company_select" ON "company" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "company_insert" ON "company" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "company_update" ON "company" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) = 'owner') WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "company_delete" ON "company" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "payee_select" ON "payee" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payee_insert" ON "payee" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payee_update" ON "payee" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payee_delete" ON "payee" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "person_select" ON "person" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "person_insert" ON "person" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "person_update" ON "person" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "person_delete" ON "person" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));