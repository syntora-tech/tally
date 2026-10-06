ALTER TYPE "public"."pay_type" ADD VALUE 'hourly_rate' BEFORE 'included';--> statement-breakpoint
ALTER TABLE "timesheet" ADD COLUMN "pay_hours" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_pay_hours_check" CHECK ("timesheet"."pay_hours" is null or "timesheet"."pay_hours" >= 0);