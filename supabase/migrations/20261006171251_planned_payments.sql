CREATE TYPE "public"."charge_mode" AS ENUM('withheld', 'on_top');--> statement-breakpoint
CREATE TYPE "public"."planned_payment_status" AS ENUM('due', 'paid', 'skipped');--> statement-breakpoint
CREATE TABLE "payment_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"name" text NOT NULL,
	"planned_expense_id" uuid,
	"person_id" uuid,
	"mode" charge_mode NOT NULL,
	"rate_percent" numeric(9, 4) NOT NULL,
	"category_id" uuid NOT NULL,
	"tx_type" "tx_type" DEFAULT 'expense' NOT NULL,
	"currency" text,
	"counterparty" text,
	"starts_on" date NOT NULL,
	"ends_on" date,
	"fee_fixed" numeric(20, 8),
	"fee_percent" numeric(9, 4),
	"fee_currency" text,
	CONSTRAINT "payment_charge_fee_check" CHECK (coalesce("payment_charge"."fee_fixed", 0) >= 0 and coalesce("payment_charge"."fee_percent", 0) between 0 and 100),
	CONSTRAINT "payment_charge_fee_currency_check" CHECK ("payment_charge"."fee_currency" ~ '^[A-Z]{3,4}$'),
	CONSTRAINT "payment_charge_type_check" CHECK ("payment_charge"."tx_type" = 'expense'),
	CONSTRAINT "payment_charge_name_check" CHECK (length(trim("payment_charge"."name")) > 0),
	CONSTRAINT "payment_charge_rate_check" CHECK ("payment_charge"."rate_percent" > 0 and "payment_charge"."rate_percent" <= 100),
	CONSTRAINT "payment_charge_target_check" CHECK (num_nonnulls("payment_charge"."planned_expense_id", "payment_charge"."person_id") = 1),
	CONSTRAINT "payment_charge_withheld_check" CHECK ("payment_charge"."mode" = 'on_top' or "payment_charge"."planned_expense_id" is not null),
	CONSTRAINT "payment_charge_period_check" CHECK ("payment_charge"."ends_on" is null or "payment_charge"."ends_on" >= "payment_charge"."starts_on"),
	CONSTRAINT "payment_charge_currency_check" CHECK ("payment_charge"."currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "payment_charge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_expense_part" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"planned_expense_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric(20, 8),
	"due_day" integer NOT NULL,
	"month_offset" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "planned_expense_part_name_check" CHECK (length(trim("planned_expense_part"."name")) > 0),
	CONSTRAINT "planned_expense_part_amount_check" CHECK ("planned_expense_part"."amount" is null or "planned_expense_part"."amount" > 0),
	CONSTRAINT "planned_expense_part_due_day_check" CHECK ("planned_expense_part"."due_day" between 1 and 31),
	CONSTRAINT "planned_expense_part_offset_check" CHECK ("planned_expense_part"."month_offset" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "planned_expense_part" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "planned_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"planned_expense_id" uuid,
	"part_id" uuid,
	"charge_id" uuid,
	"parent_id" uuid,
	"source_allocation_id" uuid,
	"person_id" uuid,
	"month" date NOT NULL,
	"due_on" date NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"tx_type" "tx_type" DEFAULT 'expense' NOT NULL,
	"counterparty" text,
	"gross" numeric(20, 8),
	"amount" numeric(20, 8) NOT NULL,
	"currency" text NOT NULL,
	"fee_amount" numeric(20, 8),
	"fee_currency" text,
	"amount_overridden" boolean DEFAULT false NOT NULL,
	"status" "planned_payment_status" DEFAULT 'due' NOT NULL,
	"skip_reason" text,
	CONSTRAINT "planned_payment_type_check" CHECK ("planned_payment"."tx_type" = 'expense'),
	CONSTRAINT "planned_payment_amount_check" CHECK ("planned_payment"."amount" >= 0),
	CONSTRAINT "planned_payment_month_check" CHECK (extract(day from "planned_payment"."month") = 1),
	CONSTRAINT "planned_payment_skip_check" CHECK (("planned_payment"."status" = 'skipped') = (length(trim(coalesce("planned_payment"."skip_reason", ''))) > 0)),
	CONSTRAINT "planned_payment_source_check" CHECK (num_nonnulls("planned_payment"."planned_expense_id", "planned_payment"."source_allocation_id") = 1),
	CONSTRAINT "planned_payment_currency_check" CHECK ("planned_payment"."currency" ~ '^[A-Z]{3,4}$'),
	CONSTRAINT "planned_payment_fee_currency_check" CHECK ("planned_payment"."fee_currency" ~ '^[A-Z]{3,4}$')
);
--> statement-breakpoint
ALTER TABLE "planned_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "allocation" DROP CONSTRAINT "allocation_target_check";--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "fee_fixed" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "fee_percent" numeric(9, 4);--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "fee_currency" text;--> statement-breakpoint
ALTER TABLE "allocation" ADD COLUMN "planned_payment_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "counterparty" text;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "fee_fixed" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "fee_percent" numeric(9, 4);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "fee_currency" text;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_planned_expense_id_planned_expense_id_fk" FOREIGN KEY ("planned_expense_id") REFERENCES "public"."planned_expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_category_type_fk" FOREIGN KEY ("category_id","tx_type") REFERENCES "public"."category"("id","tx_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_expense_part" ADD CONSTRAINT "planned_expense_part_planned_expense_id_planned_expense_id_fk" FOREIGN KEY ("planned_expense_id") REFERENCES "public"."planned_expense"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_planned_expense_id_planned_expense_id_fk" FOREIGN KEY ("planned_expense_id") REFERENCES "public"."planned_expense"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_part_id_planned_expense_part_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."planned_expense_part"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_charge_id_payment_charge_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."payment_charge"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_parent_id_planned_payment_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."planned_payment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_source_allocation_id_allocation_id_fk" FOREIGN KEY ("source_allocation_id") REFERENCES "public"."allocation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_payment" ADD CONSTRAINT "planned_payment_category_type_fk" FOREIGN KEY ("category_id","tx_type") REFERENCES "public"."category"("id","tx_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_charge_expense_idx" ON "payment_charge" USING btree ("planned_expense_id");--> statement-breakpoint
CREATE INDEX "payment_charge_person_idx" ON "payment_charge" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_expense_part_rest_key" ON "planned_expense_part" USING btree ("planned_expense_id") WHERE "planned_expense_part"."amount" is null;--> statement-breakpoint
CREATE INDEX "planned_expense_part_expense_idx" ON "planned_expense_part" USING btree ("planned_expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_payment_occurrence_key" ON "planned_payment" USING btree ("planned_expense_id",coalesce("part_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("charge_id", '00000000-0000-0000-0000-000000000000'::uuid),"month") WHERE "planned_payment"."planned_expense_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "planned_payment_payout_charge_key" ON "planned_payment" USING btree ("source_allocation_id","charge_id") WHERE "planned_payment"."source_allocation_id" is not null;--> statement-breakpoint
CREATE INDEX "planned_payment_due_idx" ON "planned_payment" USING btree ("due_on");--> statement-breakpoint
CREATE INDEX "planned_payment_parent_idx" ON "planned_payment" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "planned_payment_person_idx" ON "planned_payment" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_planned_payment_id_planned_payment_id_fk" FOREIGN KEY ("planned_payment_id") REFERENCES "public"."planned_payment"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "allocation_planned_payment_idx" ON "allocation" USING btree ("planned_payment_id");--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_fee_check" CHECK (coalesce("payee"."fee_fixed", 0) >= 0 and coalesce("payee"."fee_percent", 0) between 0 and 100);--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_fee_currency_check" CHECK ("payee"."fee_currency" ~ '^[A-Z]{3,4}$');--> statement-breakpoint
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_target_check" CHECK (num_nonnulls("allocation"."invoice_id", "allocation"."payroll_item_id", "allocation"."reimbursement_id", "allocation"."planned_payment_id") = 1);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_fee_check" CHECK (coalesce("planned_expense"."fee_fixed", 0) >= 0 and coalesce("planned_expense"."fee_percent", 0) between 0 and 100);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_fee_currency_check" CHECK ("planned_expense"."fee_currency" ~ '^[A-Z]{3,4}$');--> statement-breakpoint
CREATE POLICY "payment_charge_select" ON "payment_charge" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payment_charge_insert" ON "payment_charge" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payment_charge_update" ON "payment_charge" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "payment_charge_delete" ON "payment_charge" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_part_select" ON "planned_expense_part" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_part_insert" ON "planned_expense_part" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_part_update" ON "planned_expense_part" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_expense_part_delete" ON "planned_expense_part" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_payment_select" ON "planned_payment" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_payment_insert" ON "planned_payment" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_payment_update" ON "planned_payment" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "planned_payment_delete" ON "planned_payment" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));