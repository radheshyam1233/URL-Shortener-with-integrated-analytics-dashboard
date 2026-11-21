CREATE TABLE "clicks" (
	"id" serial PRIMARY KEY,
	"code" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"city" text,
	"country" text,
	"region" text,
	"referrer" text DEFAULT 'Direct' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "links" (
	"code" text PRIMARY KEY,
	"url" text NOT NULL,
	"created_city" text,
	"created_country" text,
	"owner_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "clicks_code_timestamp_idx" ON "clicks" ("code","timestamp" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_code_links_code_fkey" FOREIGN KEY ("code") REFERENCES "links"("code") ON DELETE CASCADE;