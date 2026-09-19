CREATE TABLE "insider_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seeker_profile_id" uuid NOT NULL,
	"insider_profile_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text NOT NULL,
	"credit_cost" integer NOT NULL,
	"rules_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insider_requests_state_check" CHECK ("insider_requests"."state" in ('SENT','ACCEPTED','DECLINED','EXPIRED','CANCELLED','PROOF_PENDING','SUBMITTED','INTERVIEW','COMPLETE','NO_INTERVIEW','CLOSED'))
);
--> statement-breakpoint
CREATE TABLE "request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"event" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insider_requests" ADD CONSTRAINT "insider_requests_seeker_profile_id_seeker_profiles_id_fk" FOREIGN KEY ("seeker_profile_id") REFERENCES "public"."seeker_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_requests" ADD CONSTRAINT "insider_requests_insider_profile_id_insider_profiles_id_fk" FOREIGN KEY ("insider_profile_id") REFERENCES "public"."insider_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insider_requests" ADD CONSTRAINT "insider_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_insider_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."insider_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "request_events_idempotency_key_idx" ON "request_events" USING btree ("idempotency_key");