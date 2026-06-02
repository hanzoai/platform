-- Hanzo rebrand migration: rename dokploy references
-- All statements are idempotent (safe to re-run)

-- 1. Rename notification column dokployRestart -> hanzoRestart (if not already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notification' AND column_name = 'dokployRestart'
  ) THEN
    ALTER TABLE "notification" RENAME COLUMN "dokployRestart" TO "hanzoRestart";
  END IF;
END $$;

-- 2. Rename scheduleType enum value 'dokploy-server' -> 'hanzo-platform' (if not already renamed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum WHERE enumlabel = 'dokploy-server'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scheduleType')
  ) THEN
    ALTER TYPE "scheduleType" RENAME VALUE 'dokploy-server' TO 'hanzo-platform';
  END IF;
END $$;

-- 3. Update metricsConfig default JSON in webServerSettings
ALTER TABLE "web_server_settings" ALTER COLUMN "metricsConfig" SET DEFAULT '{"server":{"type":"Hanzo Platform","refreshRate":60,"port":4500,"token":"","retentionDays":2,"cronJob":"","urlCallback":"","thresholds":{"cpu":0,"memory":0}},"containers":{"refreshRate":60,"services":{"include":[],"exclude":[]}}}'::jsonb;

-- 4. Update existing metricsConfig rows from "Dokploy" to "Hanzo Platform"
UPDATE "web_server_settings" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';

-- 5. Update existing metricsConfig on server table too
UPDATE "server" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';
