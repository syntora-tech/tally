ALTER TABLE "contractor_invoice" ADD COLUMN "signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD COLUMN "signed_url" text;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD COLUMN "signed_document_id" uuid;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_signed_document_id_document_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_invoice" ADD CONSTRAINT "contractor_invoice_signed_check" CHECK ("contractor_invoice"."signed_at" is not null or ("contractor_invoice"."signed_url" is null and "contractor_invoice"."signed_document_id" is null));