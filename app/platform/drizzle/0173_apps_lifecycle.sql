-- Migration: apps-lifecycle source-of-truth table
-- Contract: docs/APPS_LIFECYCLE.md (PR 1 of 5)
-- One row per (org, app, env). Records declared/running/latest tags so the
-- drift view at platform.hanzo.ai/apps can compare them. Populated by the four
-- cron readers added in PR 2 (latest/declared/running/release).
DO $$ BEGIN
 CREATE TYPE "public"."appHealth" AS ENUM('green', 'yellow', 'red');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."appEnv" AS ENUM('dev', 'test', 'main');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"org" text NOT NULL,
	"app" text NOT NULL,
	"env" "appEnv" NOT NULL,
	"repo" text NOT NULL,
	"registry" text NOT NULL,
	"declared_tag" text,
	"running_tag" text,
	"latest_tag" text,
	"release_url" text,
	"release_assets" integer DEFAULT 0 NOT NULL,
	"health" "appHealth",
	"last_observed" timestamp with time zone,
	"cluster" text,
	"namespace" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"organizationId" text
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "apps" ADD CONSTRAINT "apps_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "apps_unique" ON "apps" ("org","app","env");
