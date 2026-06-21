DO $$ BEGIN
 CREATE TYPE "public"."BuildJobStatus" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."DeployRolloutStatus" AS ENUM('pending', 'applied', 'running', 'failed', 'skipped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "build_job" (
	"buildJobId" text PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"sha" text NOT NULL,
	"ref" text NOT NULL,
	"branch" text NOT NULL,
	"target" text NOT NULL,
	"runnerPool" text NOT NULL,
	"image" text NOT NULL,
	"status" "BuildJobStatus" DEFAULT 'queued' NOT NULL,
	"dispatchId" text,
	"logs" text DEFAULT '' NOT NULL,
	"error" text,
	"rolloutStatus" "DeployRolloutStatus" DEFAULT 'skipped' NOT NULL,
	"rolloutTarget" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"createdAt" text NOT NULL,
	"startedAt" text,
	"finishedAt" text,
	"organizationId" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "build_job" ADD CONSTRAINT "build_job_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "build_job_repo_sha_target_idx" ON "build_job" ("repo","sha","target");
