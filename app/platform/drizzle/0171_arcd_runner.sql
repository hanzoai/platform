CREATE TABLE IF NOT EXISTS "arcd_runner" (
	"runnerId" text PRIMARY KEY NOT NULL,
	"poolLabel" text NOT NULL,
	"secret" text NOT NULL,
	"lastSeen" text,
	"createdAt" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "arcd_runner_poolLabel_idx" ON "arcd_runner" ("poolLabel");
