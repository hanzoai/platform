--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."deployTarget" AS ENUM('local', 'cloud', 'k8s');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "deployTarget" "deployTarget" DEFAULT 'local' NOT NULL;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "k8sClusterId" text;
--> statement-breakpoint
ALTER TABLE "application" ADD COLUMN IF NOT EXISTS "k8sNamespace" text;
