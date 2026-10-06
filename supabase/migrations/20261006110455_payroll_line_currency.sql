ALTER TABLE "payroll_line" ADD COLUMN "amount" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payroll_line" ADD COLUMN "currency" text DEFAULT 'USD' NOT NULL;