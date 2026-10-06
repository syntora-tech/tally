ALTER TABLE "supplier_act" ADD COLUMN "fx_rate" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "supplier_act" ADD COLUMN "fx_source" "fx_source";--> statement-breakpoint
ALTER TABLE "supplier_act" ADD CONSTRAINT "supplier_act_fx_check" CHECK (("supplier_act"."fx_rate" is null) = ("supplier_act"."fx_source" is null) and ("supplier_act"."fx_rate" is null or "supplier_act"."fx_rate" > 0));