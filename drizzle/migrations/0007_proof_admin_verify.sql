CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"proof_type" text NOT NULL,
	"object_key" text,
	"text_content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_proofs_proof_type_check" CHECK ("verification_proofs"."proof_type" in ('screenshot','text'))
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_proofs" ADD CONSTRAINT "verification_proofs_request_id_insider_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."insider_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_target_idx" ON "admin_audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "verification_proofs_request_id_idx" ON "verification_proofs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "insider_requests_seeker_profile_id_idx" ON "insider_requests" USING btree ("seeker_profile_id");--> statement-breakpoint
CREATE INDEX "insider_requests_insider_profile_id_idx" ON "insider_requests" USING btree ("insider_profile_id");--> statement-breakpoint
CREATE INDEX "insider_requests_state_idx" ON "insider_requests" USING btree ("state");--> statement-breakpoint
CREATE INDEX "request_events_request_id_idx" ON "request_events" USING btree ("request_id");