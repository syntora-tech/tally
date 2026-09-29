ALTER TABLE "client" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "person" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "assignment" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "billing_terms" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "contract" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "pay_terms" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "legacy_ref" text;--> statement-breakpoint
ALTER TABLE "client" ADD CONSTRAINT "client_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "assignment" ADD CONSTRAINT "assignment_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "billing_terms" ADD CONSTRAINT "billing_terms_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "pay_terms" ADD CONSTRAINT "pay_terms_legacy_ref_key" UNIQUE("legacy_ref");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_legacy_ref_key" UNIQUE("legacy_ref");