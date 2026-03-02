-- Hanzo rebrand migration: rename dokploy references
-- 1. Rename notification column dokployRestart -> hanzoRestart
ALTER TABLE "notification" RENAME COLUMN "dokployRestart" TO "hanzoRestart";

-- 2. Rename scheduleType enum value 'dokploy-server' -> 'hanzo-platform'
ALTER TYPE "scheduleType" RENAME VALUE 'dokploy-server' TO 'hanzo-platform';

-- 3. Update metricsConfig default JSON in webServerSettings
-- (existing rows with "Dokploy" in metricsConfig.server.type are handled by app code)
ALTER TABLE "web_server_settings" ALTER COLUMN "metricsConfig" SET DEFAULT '{"server":{"type":"Hanzo Platform","refreshRate":60,"port":4500,"token":"","retentionDays":2,"cronJob":"","urlCallback":"","thresholds":{"cpu":0,"memory":0}},"containers":{"refreshRate":60,"services":{"include":[],"exclude":[]}}}'::jsonb;

-- 4. Update existing metricsConfig rows from "Dokploy" to "Hanzo Platform"
UPDATE "web_server_settings" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';

-- 5. Update existing metricsConfig on server table too
UPDATE "server" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';
