CREATE TYPE "public"."app_role" AS ENUM('owner', 'finance', 'viewer');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"email" text NOT NULL,
	"role" "app_role" DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" uuid,
	"action" text NOT NULL,
	"old" jsonb,
	"new" jsonb,
	"actor" uuid,
	"actor_label" text,
	"via" text,
	"client_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_log_action_check" CHECK ("audit_log"."action" in ('INSERT', 'UPDATE', 'DELETE'))
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "audit_log_row_idx" ON "audit_log" USING btree ("table_name","row_id","at");--> statement-breakpoint
CREATE POLICY "app_user_select_self_or_owner" ON "app_user" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("app_user"."id" = (select auth.uid()) or (select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "app_user_insert_owner" ON "app_user" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "app_user_update_owner" ON "app_user" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) = 'owner') WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "app_user_delete_owner" ON "app_user" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "audit_log_select_owner_finance" ON "audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));