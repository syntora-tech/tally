ALTER TABLE "document" DROP CONSTRAINT "document_type_check";--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "package_id" uuid;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "package_pages" text;--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_package_id_document_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."document"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_package_idx" ON "document" USING btree ("package_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_package_pages_check" CHECK ("document"."package_pages" is null or "document"."package_pages" ~ '^[0-9]+(-[0-9]+)?(,[0-9]+(-[0-9]+)?)*$');--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_type_check" CHECK ("document"."type" in ('contract', 'sow', 'annex', 'invoice', 'bill', 'act', 'cv', 'nda', 'statement', 'receipt', 'other', 'package'));