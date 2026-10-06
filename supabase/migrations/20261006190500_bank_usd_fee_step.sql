ALTER TYPE "public"."payout_method" ADD VALUE 'bank_usd';--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "fee_step_from" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payee" ADD COLUMN "fee_step_fixed" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payment_charge" ADD COLUMN "fee_step_from" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payment_charge" ADD COLUMN "fee_step_fixed" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "fee_step_from" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD COLUMN "fee_step_fixed" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_fee_step_check" CHECK (("payee"."fee_step_from" is null) = ("payee"."fee_step_fixed" is null) and coalesce("payee"."fee_step_from", 1) > 0 and coalesce("payee"."fee_step_fixed", 0) >= 0);--> statement-breakpoint
ALTER TABLE "payment_charge" ADD CONSTRAINT "payment_charge_fee_step_check" CHECK (("payment_charge"."fee_step_from" is null) = ("payment_charge"."fee_step_fixed" is null) and coalesce("payment_charge"."fee_step_from", 1) > 0 and coalesce("payment_charge"."fee_step_fixed", 0) >= 0);--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_fee_step_check" CHECK (("planned_expense"."fee_step_from" is null) = ("planned_expense"."fee_step_fixed" is null) and coalesce("planned_expense"."fee_step_from", 1) > 0 and coalesce("planned_expense"."fee_step_fixed", 0) >= 0);