ALTER TABLE "transaction" ADD COLUMN "person_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "counterparty_address" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transaction_person_idx" ON "transaction" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "transaction_client_idx" ON "transaction" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "transaction_counterparty_address_idx" ON "transaction" USING btree ("counterparty_address");--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_party_check" CHECK (num_nonnulls("transaction"."person_id", "transaction"."client_id") <= 1);