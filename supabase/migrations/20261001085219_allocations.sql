CREATE TABLE "allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"transaction_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"invoice_id" uuid,
	"fx_rate" numeric(18, 6),
	"fx_source" "fx_source",
	CONSTRAINT "allocation_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "allocation_amount_check" CHECK ("allocation"."amount" > 0),
	CONSTRAINT "allocation_target_check" CHECK (num_nonnulls("allocation"."invoice_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "allocation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"on_date" date NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"source" "fx_source" NOT NULL,
	CONSTRAINT "fx_rate_key" UNIQUE("on_date","base","quote","source"),
	CONSTRAINT "fx_rate_positive_check" CHECK ("fx_rate"."rate" > 0),
	CONSTRAINT "fx_rate_base_check" CHECK ("fx_rate"."base" ~ '^[A-Z]{3,4}$'),
	CONSTRAINT "fx_rate_quote_check" CHECK ("fx_rate"."quote" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "fx_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_transaction_idx" ON "allocation" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "allocation_invoice_idx" ON "allocation" USING btree ("invoice_id");--> statement-breakpoint
CREATE POLICY "allocation_select" ON "allocation" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "allocation_insert" ON "allocation" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "allocation_update" ON "allocation" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "allocation_delete" ON "allocation" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "fx_rate_select" ON "fx_rate" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "fx_rate_insert" ON "fx_rate" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "fx_rate_update" ON "fx_rate" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "fx_rate_delete" ON "fx_rate" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));