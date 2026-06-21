-- Hanzo rebrand migration: rename dokploy references
-- All statements are idempotent (safe to re-run)

-- 0. Add whitelabelingConfig column if missing (upstream 0148_futuristic_bullseye may not have run)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webServerSettings' AND column_name = 'whitelabelingConfig'
  ) THEN
    ALTER TABLE "webServerSettings" ADD COLUMN "whitelabelingConfig" jsonb DEFAULT '{"appName":null,"appDescription":null,"logoUrl":null,"faviconUrl":null,"customCss":null,"loginLogoUrl":null,"supportUrl":null,"docsUrl":null,"errorPageTitle":null,"errorPageDescription":null,"metaTitle":null,"footerText":null}'::jsonb;
  END IF;
END $$;

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

-- 3. Update metricsConfig default JSON in webServerSettings (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'web_server_settings') THEN
    ALTER TABLE "web_server_settings" ALTER COLUMN "metricsConfig" SET DEFAULT '{"server":{"type":"Hanzo Platform","refreshRate":60,"port":4500,"token":"","retentionDays":2,"cronJob":"","urlCallback":"","thresholds":{"cpu":0,"memory":0}},"containers":{"refreshRate":60,"services":{"include":[],"exclude":[]}}}'::jsonb;
    UPDATE "web_server_settings" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';
  END IF;
END $$;

-- 4. Update existing metricsConfig on server table too (if table exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'server') THEN
    UPDATE "server" SET "metricsConfig" = jsonb_set("metricsConfig", '{server,type}', '"Hanzo Platform"') WHERE "metricsConfig"->'server'->>'type' = 'Dokploy';
  END IF;
END $$;
