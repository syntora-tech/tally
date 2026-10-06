ALTER TABLE "payroll_item" DROP CONSTRAINT "payroll_item_fx_check";--> statement-breakpoint
ALTER TABLE "payroll_line" ALTER COLUMN "amount" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_line" DROP COLUMN "amount_usd";--> statement-breakpoint
ALTER TABLE "payroll_item" ADD CONSTRAINT "payroll_item_fx_check" CHECK (("payroll_item"."payout_fx_rate" is null) = ("payroll_item"."fx_source" is null) and ("payroll_item"."payout_fx_rate" is null or "payroll_item"."total_uah" is not null));--> statement-breakpoint
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_currency_check" CHECK ("payroll_line"."currency" in ('USD', 'UAH'));