CREATE TABLE "invoice_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"total" numeric(20, 8) NOT NULL,
	"snapshot" jsonb,
	"pdf_file_id" text,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	CONSTRAINT "invoice_revision_key" UNIQUE("invoice_id","revision")
);
--> statement-breakpoint
ALTER TABLE "invoice_revision" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_revision" ADD CONSTRAINT "invoice_revision_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "invoice_revision_select" ON "invoice_revision" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));