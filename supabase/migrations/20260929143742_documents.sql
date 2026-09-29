CREATE TYPE "public"."doc_status" AS ENUM('draft', 'issued', 'void');--> statement-breakpoint
CREATE TABLE "document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"type" text NOT NULL,
	"number" text,
	"number_key" text GENERATED ALWAYS AS (translate(upper(regexp_replace(number, '[[:space:]-]', '', 'g')), 'A', 'А')) STORED,
	"title" text NOT NULL,
	"doc_date" date,
	"url" text,
	"drive_file_id" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" bigint,
	"status" "doc_status" DEFAULT 'issued' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"supersedes_id" uuid,
	"notes" text,
	CONSTRAINT "document_supersedes_key" UNIQUE("supersedes_id"),
	CONSTRAINT "document_type_check" CHECK ("document"."type" in ('contract', 'sow', 'annex', 'invoice', 'act', 'cv', 'nda', 'statement', 'other')),
	CONSTRAINT "document_version_check" CHECK ("document"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"document_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	CONSTRAINT "document_link_key" UNIQUE("document_id","entity_type","entity_id"),
	CONSTRAINT "document_link_entity_type_check" CHECK ("document_link"."entity_type" in ('person', 'payee', 'client', 'contract', 'assignment', 'invoice', 'supplier_act', 'trip', 'transaction'))
);
--> statement-breakpoint
ALTER TABLE "document_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "drive_folder" (
	"path" text PRIMARY KEY NOT NULL,
	"folder_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drive_folder" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_supersedes_id_document_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_number_key_idx" ON "document" USING btree ("number_key");--> statement-breakpoint
CREATE INDEX "document_link_entity_idx" ON "document_link" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE POLICY "document_select" ON "document" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "document_insert" ON "document" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "document_update" ON "document" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "document_delete" ON "document" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "document_link_select" ON "document_link" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "document_link_insert" ON "document_link" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "document_link_update" ON "document_link" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "document_link_delete" ON "document_link" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));