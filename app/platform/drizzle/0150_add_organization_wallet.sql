CREATE TABLE IF NOT EXISTS "organization_wallet" (
	"wallet_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL UNIQUE,
	"owner_id" text NOT NULL,
	"balance" numeric(10, 2) DEFAULT '0' NOT NULL,
	"monthly_credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"purchased_credits" numeric(10, 2) DEFAULT '0' NOT NULL,
	"plan" text DEFAULT 'hobby' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"auto_topup_enabled" boolean DEFAULT false NOT NULL,
	"auto_topup_threshold" numeric(10, 2),
	"auto_topup_amount" numeric(10, 2),
	"auto_topup_last_triggered" timestamp with time zone,
	"cycle_start" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_end" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "wallet_transactions" (
	"transaction_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" uuid NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"balance_before" numeric(10, 2) NOT NULL,
	"balance_after" numeric(10, 2) NOT NULL,
	"stripe_payment_intent_id" text,
	"description" text,
	"application_id" text,
	"ai_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "app_usage_metrics" (
	"metric_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"cpu_seconds" numeric(12, 6) NOT NULL,
	"memory_gb_seconds" numeric(12, 6) NOT NULL,
	"storage_gb_seconds" numeric(12, 6) NOT NULL,
	"egress_gb" numeric(12, 6) NOT NULL,
	"cpu_cost" numeric(10, 6) NOT NULL,
	"memory_cost" numeric(10, 6) NOT NULL,
	"storage_cost" numeric(10, 6) NOT NULL,
	"egress_cost" numeric(10, 6) NOT NULL,
	"total_cost" numeric(10, 6) NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"charged_at" timestamp with time zone,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ai_usage_metrics" (
	"metric_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" text NOT NULL UNIQUE,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"application_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"endpoint" text NOT NULL,
	"byok" boolean DEFAULT false NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"provider_cost" numeric(10, 6) NOT NULL,
	"cost" numeric(10, 6) NOT NULL,
	"charged" boolean DEFAULT false NOT NULL,
	"charged_at" timestamp with time zone,
	"transaction_id" uuid,
	"request_duration_ms" integer,
	"error_occurred" boolean DEFAULT false NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_org_wallet_org_id" ON "organization_wallet" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_org_wallet_owner" ON "organization_wallet" ("owner_id");
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_wallet" ON "wallet_transactions" ("wallet_id");
CREATE INDEX IF NOT EXISTS "idx_wallet_tx_org" ON "wallet_transactions" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_app" ON "app_usage_metrics" ("application_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_org" ON "app_usage_metrics" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_app_usage_uncharged" ON "app_usage_metrics" ("charged") WHERE charged = false;
CREATE INDEX IF NOT EXISTS "idx_ai_usage_org" ON "ai_usage_metrics" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_ai_usage_uncharged" ON "ai_usage_metrics" ("charged") WHERE charged = false;
