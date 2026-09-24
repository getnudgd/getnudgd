ALTER TABLE "notifications" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_idempotency_key_uq" ON "notifications" USING btree ("idempotency_key");