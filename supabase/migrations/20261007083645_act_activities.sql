ALTER TABLE "adjustment" ADD COLUMN "supplier_act_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD COLUMN "supplier_act_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_act" ADD COLUMN "rate_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "adjustment" ADD CONSTRAINT "adjustment_supplier_act_id_supplier_act_id_fk" FOREIGN KEY ("supplier_act_id") REFERENCES "public"."supplier_act"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_supplier_act_id_supplier_act_id_fk" FOREIGN KEY ("supplier_act_id") REFERENCES "public"."supplier_act"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
