DROP INDEX "supplier_act_number_key";--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_act_number_key" ON "supplier_act" USING btree ("contract_id","number") WHERE "supplier_act"."status" <> 'draft' and not "supplier_act"."is_legacy";
