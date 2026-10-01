CREATE TABLE "mcp_call_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" uuid,
	"tool" text NOT NULL,
	"args_hash" text,
	"outcome" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_call_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_client_policy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"client_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"profile" text DEFAULT 'read_only' NOT NULL,
	"allowed_tools" text[],
	"token_hash" text,
	"token_hint" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "mcp_client_policy_client_id_key" UNIQUE("client_id"),
	CONSTRAINT "mcp_client_policy_token_hash_key" UNIQUE("token_hash"),
	CONSTRAINT "mcp_client_policy_profile_check" CHECK ("mcp_client_policy"."profile" in ('read_only', 'assistant', 'custom')),
	CONSTRAINT "mcp_client_policy_name_check" CHECK (length(trim("mcp_client_policy"."client_name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "mcp_client_policy" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_idempotency" (
	"client_id" text NOT NULL,
	"key" text NOT NULL,
	"tool" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_idempotency_client_id_key_pk" PRIMARY KEY("client_id","key")
);
--> statement-breakpoint
ALTER TABLE "mcp_idempotency" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_client_policy" ADD CONSTRAINT "mcp_client_policy_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_call_log_client_at_idx" ON "mcp_call_log" USING btree ("client_id","at");--> statement-breakpoint
CREATE POLICY "mcp_call_log_select_owner" ON "mcp_call_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "mcp_client_policy_select_owner" ON "mcp_client_policy" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "mcp_client_policy_insert_owner" ON "mcp_client_policy" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "mcp_client_policy_update_owner" ON "mcp_client_policy" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) = 'owner') WITH CHECK ((select public.current_app_role()) = 'owner');