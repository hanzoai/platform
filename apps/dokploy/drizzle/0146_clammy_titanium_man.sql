CREATE TYPE "public"."patchType" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
ALTER TABLE "patch" ADD COLUMN "type" "patchType" DEFAULT 'update' NOT NULL;