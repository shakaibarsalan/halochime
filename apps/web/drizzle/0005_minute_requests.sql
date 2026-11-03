CREATE TYPE "public"."minute_request_status" AS ENUM('open', 'done', 'replaced');--> statement-breakpoint
CREATE TABLE "minute_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"requested_by" text,
	"requester_name" text NOT NULL,
	"requester_email" text NOT NULL,
	"minutes" integer NOT NULL,
	"note" text,
	"status" "minute_request_status" DEFAULT 'open' NOT NULL,
	"usage_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "minute_requests" ADD CONSTRAINT "minute_requests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_requests" ADD CONSTRAINT "minute_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minute_requests" ADD CONSTRAINT "minute_requests_usage_event_id_usage_events_id_fk" FOREIGN KEY ("usage_event_id") REFERENCES "public"."usage_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "minute_requests_org_idx" ON "minute_requests" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "minute_requests_one_open_uq" ON "minute_requests" USING btree ("organization_id") WHERE "minute_requests"."status" = 'open';