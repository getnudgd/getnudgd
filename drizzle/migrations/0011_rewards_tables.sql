CREATE TABLE "insider_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"insider_profile_id" uuid NOT NULL,
	"tranche" integer NOT NULL,
	"points" integer NOT NULL,
	"ledger_txn_id" uuid NOT NULL,
	"released_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insider_rewards_tranche_check" CHECK ("insider_rewards"."tranche" in (1, 2)),
	CONSTRAINT "insider_rewards_points_check" CHECK ("insider_rewards"."points" > 0)
);
--> statement-breakpoint
CREATE TABLE "reward_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"insider_profile_id" uuid NOT NULL,
	"points" integer NOT NULL,
	"brand" text NOT NULL,
	"denomination_paise" integer NOT NULL,
	"vendor" text NOT NULL,
	"vendor_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "reward_redemptions_status_check" CHECK ("reward_redemptions"."status" in ('pending','fulfilled','rejected')),
	CONSTRAINT "reward_redemptions_points_check" CHECK ("reward_redemptions"."points" > 0),
	CONSTRAINT "reward_redemptions_denomination_check" CHECK ("reward_redemptions"."denomination_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "insider_rewards" ADD CONSTRAINT "insider_rewards_request_id_insider_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."insider_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_rewards" ADD CONSTRAINT "insider_rewards_insider_profile_id_insider_profiles_id_fk" FOREIGN KEY ("insider_profile_id") REFERENCES "public"."insider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_rewards" ADD CONSTRAINT "insider_rewards_ledger_txn_id_ledger_txns_id_fk" FOREIGN KEY ("ledger_txn_id") REFERENCES "public"."ledger_txns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_redemptions" ADD CONSTRAINT "reward_redemptions_insider_profile_id_insider_profiles_id_fk" FOREIGN KEY ("insider_profile_id") REFERENCES "public"."insider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "insider_rewards_request_tranche_uq" ON "insider_rewards" USING btree ("request_id","tranche");--> statement-breakpoint
CREATE INDEX "insider_rewards_insider_profile_id_idx" ON "insider_rewards" USING btree ("insider_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_redemptions_idempotency_key_uq" ON "reward_redemptions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "reward_redemptions_status_created_idx" ON "reward_redemptions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reward_redemptions_insider_created_idx" ON "reward_redemptions" USING btree ("insider_profile_id","created_at");