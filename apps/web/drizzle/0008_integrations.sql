CREATE TYPE "public"."integration_kind" AS ENUM('hubspot', 'gohighlevel', 'zoho', 'calcom', 'booking_link', 'database');--> statement-breakpoint
CREATE TABLE "integration_queries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"sql" text NOT NULL,
	"parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "integration_kind" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_encrypted" text,
	"secret_hint" text,
	"agent_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"log_conversations" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_queries" ADD CONSTRAINT "integration_queries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_queries" ADD CONSTRAINT "integration_queries_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integration_queries_org_idx" ON "integration_queries" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_queries_integration_name_uq" ON "integration_queries" USING btree ("integration_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_kind_uq" ON "integrations" USING btree ("organization_id","kind");