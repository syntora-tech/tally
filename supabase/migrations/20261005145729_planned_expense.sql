CREATE TYPE "public"."planned_frequency" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TABLE "planned_expense" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"tx_type" "tx_type" DEFAULT 'expense' NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"frequency" "planned_frequency" DEFAULT 'monthly' NOT NULL,
	"anchor_month" integer,
	"due_day" integer,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"notes" text,
	CONSTRAINT "planned_expense_type_check" CHECK ("planned_expense"."tx_type" = 'expense'),
	CONSTRAINT "planned_expense_name_check" CHECK (length(trim("planned_expense"."name")) > 0),
	CONSTRAINT "planned_expense_amount_check" CHECK ("planned_expense"."amount" > 0),
	CONSTRAINT "planned_expense_anchor_check" CHECK (("planned_expense"."frequency" = 'monthly') = ("planned_expense"."anchor_month" is null) and coalesce("planned_expense"."anchor_month", 1) between 1 and 12),
	CONSTRAINT "planned_expense_due_day_check" CHECK (coalesce("planned_expense"."due_day", 1) between 1 and 31),
	CONSTRAINT "planned_expense_period_check" CHECK ("planned_expense"."ends_on" is null or "planned_expense"."ends_on" >= "planned_expense"."starts_on"),
	CONSTRAINT "planned_expense_currency_check" CHECK ("planned_expense"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "planned_expense" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_category_type_fk" FOREIGN KEY ("category_id","tx_type") REFERENCES "public"."category"("id","tx_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "planned_expense_select" ON "planned_expense" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_insert" ON "planned_expense" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_update" ON "planned_expense" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_delete" ON "planned_expense" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));