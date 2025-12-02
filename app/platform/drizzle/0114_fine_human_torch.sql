CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'pending', 'paid', 'overdue', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('credit_purchase', 'wire_transfer', 'crypto_payment', 'usage_deduction', 'admin_adjustment', 'refund');--> statement-breakpoint
CREATE TYPE "public"."usage_type" AS ENUM('compute', 'ai_credits', 'storage', 'bandwidth', 'api_calls');--> statement-breakpoint
CREATE TABLE "credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_billing_id" text NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer,
	"description" text,
	"external_reference" text,
	"payment_method" text,
	"metadata" jsonb,
	"processed_by" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_billing_id" text NOT NULL,
	"invoice_number" text NOT NULL,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"tax" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"paid_amount" integer DEFAULT 0,
	"paid_at" timestamp,
	"payment_method" text,
	"payment_reference" text,
	"line_items" jsonb DEFAULT '[]'::jsonb,
	"due_date" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "organization_billing" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"billing_email" text,
	"billing_name" text,
	"billing_address" text,
	"preferred_payment_method" text DEFAULT 'crypto',
	"crypto_addresses" jsonb,
	"low_balance_threshold" integer DEFAULT 10000,
	"low_balance_alert_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_billing_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "payment_instructions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true,
	"instructions" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_record" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_billing_id" text NOT NULL,
	"type" "usage_type" NOT NULL,
	"resource_id" text,
	"resource_name" text,
	"resource_type" text,
	"quantity" numeric(20, 6) NOT NULL,
	"unit" text NOT NULL,
	"unit_price" integer NOT NULL,
	"total_cost" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"metadata" jsonb,
	"billed" boolean DEFAULT false,
	"billed_at" timestamp,
	"transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_transaction" ADD CONSTRAINT "credit_transaction_organization_billing_id_organization_billing_id_fk" FOREIGN KEY ("organization_billing_id") REFERENCES "public"."organization_billing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_billing_id_organization_billing_id_fk" FOREIGN KEY ("organization_billing_id") REFERENCES "public"."organization_billing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_billing" ADD CONSTRAINT "organization_billing_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_record" ADD CONSTRAINT "usage_record_organization_billing_id_organization_billing_id_fk" FOREIGN KEY ("organization_billing_id") REFERENCES "public"."organization_billing"("id") ON DELETE cascade ON UPDATE no action;