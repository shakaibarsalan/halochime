CREATE TYPE "public"."ab_test_status" AS ENUM('running', 'ended');--> statement-breakpoint
CREATE TYPE "public"."powered_by_mode" AS ENUM('halochime', 'hidden', 'custom');--> statement-breakpoint
CREATE TYPE "public"."agent_test_run_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."channel_kind" AS ENUM('phone', 'whatsapp');--> statement-breakpoint
ALTER TYPE "public"."message_role" ADD VALUE 'staff';--> statement-breakpoint
CREATE TABLE "voice_clones" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text DEFAULT 'elevenlabs' NOT NULL,
	"provider_voice_id" text NOT NULL,
	"consent_by" text,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_ab_tests" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version_a_id" text NOT NULL,
	"version_b_id" text NOT NULL,
	"split_b" integer NOT NULL,
	"status" "ab_test_status" DEFAULT 'running' NOT NULL,
	"winner_version_id" text,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_test_cases" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"question" text NOT NULL,
	"must_say" text DEFAULT '' NOT NULL,
	"must_not_say" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_test_results" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"case_id" text,
	"question" text NOT NULL,
	"must_say" text DEFAULT '' NOT NULL,
	"must_not_say" text DEFAULT '' NOT NULL,
	"answer" text DEFAULT '' NOT NULL,
	"pass" boolean DEFAULT false NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"error" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_test_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version_id" text,
	"version_name" text,
	"started_by" text,
	"status" "agent_test_run_status" DEFAULT 'running' NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"model" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"name" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_branding" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"powered_by" "powered_by_mode" DEFAULT 'halochime' NOT NULL,
	"powered_by_label" text,
	"powered_by_url" text,
	"brand_name" text,
	"logo_content_type" text,
	"logo_data" text,
	"logo_version" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_page_help" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"proactive" jsonb DEFAULT '{"enabled":false,"rules":[],"defaultMessage":"Need a hand? Tap here and ask us."}'::jsonb NOT NULL,
	"page_guide" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_help_offers" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"kind" "channel_kind" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"external_id" text,
	"config" jsonb NOT NULL,
	"secrets_encrypted" text,
	"secret_hints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_inbound" (
	"channel_id" text NOT NULL,
	"external_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "taken_over_by_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "taken_over_by_name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "taken_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_version_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "ab_test_id" text;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_clones" ADD CONSTRAINT "voice_clones_consent_by_user_id_fk" FOREIGN KEY ("consent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_version_a_id_agent_versions_id_fk" FOREIGN KEY ("version_a_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_version_b_id_agent_versions_id_fk" FOREIGN KEY ("version_b_id") REFERENCES "public"."agent_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_winner_version_id_agent_versions_id_fk" FOREIGN KEY ("winner_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ab_tests" ADD CONSTRAINT "agent_ab_tests_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_cases" ADD CONSTRAINT "agent_test_cases_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_cases" ADD CONSTRAINT "agent_test_cases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_results" ADD CONSTRAINT "agent_test_results_run_id_agent_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_results" ADD CONSTRAINT "agent_test_results_case_id_agent_test_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."agent_test_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_runs" ADD CONSTRAINT "agent_test_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_runs" ADD CONSTRAINT "agent_test_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_runs" ADD CONSTRAINT "agent_test_runs_version_id_agent_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_runs" ADD CONSTRAINT "agent_test_runs_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_branding" ADD CONSTRAINT "workspace_branding_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_page_help" ADD CONSTRAINT "agent_page_help_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_page_help" ADD CONSTRAINT "agent_page_help_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_help_offers" ADD CONSTRAINT "conversation_help_offers_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_help_offers" ADD CONSTRAINT "conversation_help_offers_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_channels" ADD CONSTRAINT "agent_channels_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_channels" ADD CONSTRAINT "agent_channels_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_inbound" ADD CONSTRAINT "channel_inbound_channel_id_agent_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."agent_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_clones_org_idx" ON "voice_clones" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_ab_tests_agent_idx" ON "agent_ab_tests" USING btree ("agent_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_ab_tests_one_running_uq" ON "agent_ab_tests" USING btree ("agent_id") WHERE "agent_ab_tests"."status" = 'running';--> statement-breakpoint
CREATE INDEX "agent_test_cases_agent_idx" ON "agent_test_cases" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_test_results_run_idx" ON "agent_test_results" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "agent_test_runs_agent_idx" ON "agent_test_runs" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_test_runs_org_idx" ON "agent_test_runs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_versions_agent_idx" ON "agent_versions" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_channels_org_idx" ON "agent_channels" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_channels_agent_kind_uq" ON "agent_channels" USING btree ("agent_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_channels_kind_external_uq" ON "agent_channels" USING btree ("kind","external_id") WHERE "agent_channels"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_inbound_uq" ON "channel_inbound" USING btree ("channel_id","external_message_id");--> statement-breakpoint
CREATE INDEX "channel_inbound_created_idx" ON "channel_inbound" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ab_test_id_agent_ab_tests_id_fk" FOREIGN KEY ("ab_test_id") REFERENCES "public"."agent_ab_tests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_ab_test_idx" ON "conversations" USING btree ("ab_test_id") WHERE "conversations"."ab_test_id" is not null;--> statement-breakpoint
CREATE INDEX "conversations_whatsapp_open_idx" ON "conversations" USING btree ("agent_id","visitor_id") WHERE "conversations"."channel" = 'whatsapp' and "conversations"."status" = 'active';