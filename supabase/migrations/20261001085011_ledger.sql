CREATE TYPE "public"."account_kind" AS ENUM('bank', 'crypto', 'cash');--> statement-breakpoint
CREATE TYPE "public"."fx_source" AS ENUM('bank_actual', 'nbu', 'manual');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('revenue', 'expense', 'transfer', 'fx_exchange', 'crypto_buy', 'crypto_sell', 'crypto_swap', 'adjustment');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"name" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"currency" text NOT NULL,
	"network" text,
	"opening_balance" numeric(20, 8) DEFAULT '0' NOT NULL,
	"opening_date" date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "account_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "account_name_key" UNIQUE("name"),
	CONSTRAINT "account_currency_check" CHECK ("account"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"tx_type" "tx_type" NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "category_type_name_key" UNIQUE("tx_type","name"),
	CONSTRAINT "category_id_type_key" UNIQUE("id","tx_type"),
	CONSTRAINT "category_name_check" CHECK (length(trim("category"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "posting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"is_fee" boolean DEFAULT false NOT NULL,
	CONSTRAINT "posting_amount_check" CHECK ("posting"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "posting" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"occurred_on" date NOT NULL,
	"type" "tx_type" NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text,
	"counterparty" text,
	"external_ref" text,
	CONSTRAINT "transaction_legacy_ref_key" UNIQUE("legacy_ref")
);
--> statement-breakpoint
ALTER TABLE "transaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "posting" ADD CONSTRAINT "posting_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posting" ADD CONSTRAINT "posting_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_type_fk" FOREIGN KEY ("category_id","type") REFERENCES "public"."category"("id","tx_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posting_transaction_idx" ON "posting" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "posting_account_idx" ON "posting" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transaction_occurred_on_idx" ON "transaction" USING btree ("occurred_on");--> statement-breakpoint
CREATE INDEX "transaction_external_ref_idx" ON "transaction" USING btree ("external_ref");--> statement-breakpoint
CREATE POLICY "account_select" ON "account" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "account_insert" ON "account" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "account_update" ON "account" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "account_delete" ON "account" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "category_select" ON "category" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "category_insert" ON "category" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "category_update" ON "category" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "category_delete" ON "category" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "posting_select" ON "posting" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "posting_insert" ON "posting" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "posting_update" ON "posting" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "posting_delete" ON "posting" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "transaction_select" ON "transaction" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "transaction_insert" ON "transaction" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "transaction_update" ON "transaction" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "transaction_delete" ON "transaction" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));