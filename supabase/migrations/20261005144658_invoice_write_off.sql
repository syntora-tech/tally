ALTER TABLE "invoice" ADD COLUMN "written_off_on" date;--> statement-breakpoint
ALTER TABLE "invoice" ADD COLUMN "write_off_reason" text;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_write_off_check" CHECK ("invoice"."status" <> 'written_off' or ("invoice"."written_off_on" is not null and length(trim(coalesce("invoice"."write_off_reason", ''))) > 0));