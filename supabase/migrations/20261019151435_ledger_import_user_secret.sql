CREATE TABLE "ledger_import" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"kind" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"committed_at" timestamp with time zone,
	"committed_by" uuid,
	CONSTRAINT "ledger_import_kind_check" CHECK ("ledger_import"."kind" in ('bank', 'crypto')),
	CONSTRAINT "ledger_import_status_check" CHECK ("ledger_import"."status" in ('draft', 'committed', 'discarded')),
	CONSTRAINT "ledger_import_committed_check" CHECK (("ledger_import"."status" = 'committed') = ("ledger_import"."committed_at" is not null)),
	CONSTRAINT "ledger_import_rows_check" CHECK (jsonb_typeof("ledger_import"."rows") = 'array')
);
--> statement-breakpoint
ALTER TABLE "ledger_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_secret" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"user_id" uuid DEFAULT auth.uid() NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" text NOT NULL,
	"hint" text NOT NULL,
	"verified_at" timestamp with time zone,
	CONSTRAINT "user_secret_user_kind_key" UNIQUE("user_id","kind"),
	CONSTRAINT "user_secret_kind_check" CHECK ("user_secret"."kind" in ('anthropic_api_key')),
	CONSTRAINT "user_secret_ciphertext_check" CHECK ("user_secret"."ciphertext" like 'v1:%')
);
--> statement-breakpoint
ALTER TABLE "user_secret" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_secret" ADD CONSTRAINT "user_secret_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_import_created_at_idx" ON "ledger_import" USING btree ("created_at");--> statement-breakpoint
CREATE POLICY "ledger_import_select" ON "ledger_import" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "ledger_import_insert" ON "ledger_import" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "ledger_import_update" ON "ledger_import" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "ledger_import_delete" ON "ledger_import" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "user_secret_select_own" ON "user_secret" AS PERMISSIVE FOR SELECT TO "authenticated" USING (user_id = (select auth.uid()) and (select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "user_secret_insert_own" ON "user_secret" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (user_id = (select auth.uid()) and (select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "user_secret_update_own" ON "user_secret" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (user_id = (select auth.uid()) and (select public.current_app_role()) is not null) WITH CHECK (user_id = (select auth.uid()) and (select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "user_secret_delete_own" ON "user_secret" AS PERMISSIVE FOR DELETE TO "authenticated" USING (user_id = (select auth.uid()) and (select public.current_app_role()) is not null);