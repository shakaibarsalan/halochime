ALTER TABLE "agents" ADD COLUMN "collect_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "collected_data" jsonb;