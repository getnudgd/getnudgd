CREATE TABLE "resumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seeker_profile_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"status" text DEFAULT 'uploaded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "resumes_status_check" CHECK ("resumes"."status" in ('uploaded','parsed','tailored'))
);
--> statement-breakpoint
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_seeker_profile_id_seeker_profiles_id_fk" FOREIGN KEY ("seeker_profile_id") REFERENCES "public"."seeker_profiles"("id") ON DELETE no action ON UPDATE no action;