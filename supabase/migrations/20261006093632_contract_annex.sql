CREATE TABLE "contract_annex" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"contract_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"title" text,
	"signed_on" date,
	"valid_from" date,
	"valid_to" date,
	"status" text DEFAULT 'active' NOT NULL,
	"payment_due_rule" jsonb,
	"invoice_date_rule" jsonb,
	"notes" text,
	CONSTRAINT "contract_annex_number_key" UNIQUE("contract_id","kind","number"),
	CONSTRAINT "contract_annex_kind_check" CHECK ("contract_annex"."kind" in ('sow', 'annex')),
	CONSTRAINT "contract_annex_status_check" CHECK ("contract_annex"."status" in ('draft', 'active', 'ended')),
	CONSTRAINT "contract_annex_dates_check" CHECK ("contract_annex"."valid_to" is null or "contract_annex"."valid_from" is null or "contract_annex"."valid_to" >= "contract_annex"."valid_from"),
	CONSTRAINT "contract_annex_payment_due_rule_check" CHECK ("contract_annex"."payment_due_rule" is null or "contract_annex"."payment_due_rule" ->> 'type' in ('day_of_month', 'net_days', 'net_working_days')),
	CONSTRAINT "contract_annex_invoice_date_rule_check" CHECK ("contract_annex"."invoice_date_rule" is null or "contract_annex"."invoice_date_rule" ->> 'type' in ('first_working_day_after_period', 'nth_working_day_after_period'))
);
--> statement-breakpoint
ALTER TABLE "contract_annex" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_link" DROP CONSTRAINT "document_link_entity_type_check";--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "annex_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "annex_id" uuid;--> statement-breakpoint
ALTER TABLE "contract_annex" ADD CONSTRAINT "contract_annex_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_annex_contract_idx" ON "contract_annex" USING btree ("contract_id");--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_annex_id_contract_annex_id_fk" FOREIGN KEY ("annex_id") REFERENCES "public"."contract_annex"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_annex_id_contract_annex_id_fk" FOREIGN KEY ("annex_id") REFERENCES "public"."contract_annex"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_annex_idx" ON "assignment" USING btree ("annex_id");--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_entity_type_check" CHECK ("document_link"."entity_type" in ('person', 'payee', 'client', 'contract', 'contract_annex', 'assignment', 'invoice', 'supplier_act', 'trip', 'transaction'));--> statement-breakpoint
CREATE POLICY "contract_annex_select" ON "contract_annex" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_annex_insert" ON "contract_annex" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_annex_update" ON "contract_annex" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "contract_annex_delete" ON "contract_annex" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));