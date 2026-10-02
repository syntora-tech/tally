-- Existing free-text networks become the fixed codes before the check constraints below.
UPDATE "account" SET "network" = CASE upper(btrim("network"))
  WHEN 'ERC20' THEN 'ETH' WHEN 'ETHEREUM' THEN 'ETH' WHEN 'TRC20' THEN 'TRON' WHEN 'BEP20' THEN 'BSC'
  WHEN 'SOL' THEN 'SOLANA' WHEN 'MATIC' THEN 'POLYGON' ELSE upper(btrim("network")) END
WHERE "network" IS NOT NULL;--> statement-breakpoint
UPDATE "payee" SET "wallet_network" = CASE upper(btrim("wallet_network"))
  WHEN 'ERC20' THEN 'ETH' WHEN 'ETHEREUM' THEN 'ETH' WHEN 'TRC20' THEN 'TRON' WHEN 'BEP20' THEN 'BSC'
  WHEN 'SOL' THEN 'SOLANA' WHEN 'MATIC' THEN 'POLYGON' ELSE upper(btrim("wallet_network")) END
WHERE "wallet_network" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "crypto_wallet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"person_id" uuid,
	"client_id" uuid,
	"network" text NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "crypto_wallet_network_address_key" UNIQUE("network","address"),
	CONSTRAINT "crypto_wallet_owner_check" CHECK (num_nonnulls("crypto_wallet"."person_id", "crypto_wallet"."client_id") = 1),
	CONSTRAINT "crypto_wallet_address_check" CHECK ("crypto_wallet"."address" = btrim("crypto_wallet"."address") and "crypto_wallet"."address" <> ''),
	CONSTRAINT "crypto_wallet_network_check" CHECK ("crypto_wallet"."network" in ('ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'AVALANCHE', 'TRON', 'SOLANA', 'BTC', 'TON'))
);
--> statement-breakpoint
ALTER TABLE "crypto_wallet" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "crypto_wallet" ADD CONSTRAINT "crypto_wallet_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_wallet" ADD CONSTRAINT "crypto_wallet_client_id_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."client"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crypto_wallet_person_idx" ON "crypto_wallet" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "crypto_wallet_client_idx" ON "crypto_wallet" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_network_address_key" ON "account" USING btree ("network","address") WHERE "account"."address" is not null;--> statement-breakpoint
ALTER TABLE "payee" ADD CONSTRAINT "payee_wallet_network_check" CHECK ("payee"."wallet_network" in ('ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'AVALANCHE', 'TRON', 'SOLANA', 'BTC', 'TON'));--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_network_check" CHECK ("account"."network" in ('ETH', 'BSC', 'POLYGON', 'ARBITRUM', 'BASE', 'OPTIMISM', 'AVALANCHE', 'TRON', 'SOLANA', 'BTC', 'TON'));--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_address_network_check" CHECK ("account"."address" is null or "account"."network" is not null);--> statement-breakpoint
CREATE POLICY "crypto_wallet_select" ON "crypto_wallet" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "crypto_wallet_insert" ON "crypto_wallet" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "crypto_wallet_update" ON "crypto_wallet" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "crypto_wallet_delete" ON "crypto_wallet" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));