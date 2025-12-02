import { relations } from "drizzle-orm";
import {
	boolean,
	decimal,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { organization } from "./account";

// Enums
export const transactionType = pgEnum("transaction_type", [
	"credit_purchase",
	"wire_transfer",
	"crypto_payment",
	"usage_deduction",
	"admin_adjustment",
	"refund",
]);

export const transactionStatus = pgEnum("transaction_status", [
	"pending",
	"completed",
	"failed",
	"cancelled",
]);

export const usageType = pgEnum("usage_type", [
	"compute",
	"ai_credits",
	"storage",
	"bandwidth",
	"api_calls",
]);

export const invoiceStatus = pgEnum("invoice_status", [
	"draft",
	"pending",
	"paid",
	"overdue",
	"cancelled",
]);

// Organization Billing - Stores credit balance and billing settings
export const organizationBilling = pgTable("organization_billing", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organization_id")
		.notNull()
		.unique()
		.references(() => organization.id, { onDelete: "cascade" }),

	// Credit balance (in USD cents to avoid floating point issues)
	creditBalance: integer("credit_balance").notNull().default(0),

	// Billing contact info
	billingEmail: text("billing_email"),
	billingName: text("billing_name"),
	billingAddress: text("billing_address"),

	// Payment settings
	preferredPaymentMethod: text("preferred_payment_method").default("crypto"),

	// Crypto wallet addresses for this org (for receiving refunds/credits)
	cryptoAddresses: jsonb("crypto_addresses").$type<{
		ethereum?: string;
		bitcoin?: string;
		usdc?: string;
		usdt?: string;
	}>(),

	// Low balance alert threshold (in cents)
	lowBalanceThreshold: integer("low_balance_threshold").default(10000), // $100 default
	lowBalanceAlertEnabled: boolean("low_balance_alert_enabled").default(true),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const organizationBillingRelations = relations(
	organizationBilling,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [organizationBilling.organizationId],
			references: [organization.id],
		}),
		transactions: many(creditTransaction),
		usageRecords: many(usageRecord),
		invoices: many(invoice),
	}),
);

// Credit Transactions - Log all credit changes
export const creditTransaction = pgTable("credit_transaction", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationBillingId: text("organization_billing_id")
		.notNull()
		.references(() => organizationBilling.id, { onDelete: "cascade" }),

	// Transaction details
	type: transactionType("type").notNull(),
	status: transactionStatus("status").notNull().default("pending"),

	// Amount in cents (positive for credits, negative for debits)
	amount: integer("amount").notNull(),

	// Balance after this transaction
	balanceAfter: integer("balance_after"),

	// Description
	description: text("description"),

	// Reference for external systems (crypto tx hash, wire reference, etc.)
	externalReference: text("external_reference"),

	// Payment method details
	paymentMethod: text("payment_method"), // crypto_eth, crypto_btc, wire, admin

	// Metadata (crypto tx details, wire details, etc.)
	metadata: jsonb("metadata").$type<{
		cryptoTxHash?: string;
		cryptoNetwork?: string;
		cryptoAmount?: string;
		cryptoCurrency?: string;
		wireReference?: string;
		wireBank?: string;
		adminUserId?: string;
		adminNote?: string;
		invoiceId?: string;
	}>(),

	// Who processed this transaction (for admin adjustments)
	processedBy: text("processed_by"),
	processedAt: timestamp("processed_at"),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const creditTransactionRelations = relations(
	creditTransaction,
	({ one }) => ({
		organizationBilling: one(organizationBilling, {
			fields: [creditTransaction.organizationBillingId],
			references: [organizationBilling.id],
		}),
	}),
);

// Usage Records - Track compute and AI usage
export const usageRecord = pgTable("usage_record", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationBillingId: text("organization_billing_id")
		.notNull()
		.references(() => organizationBilling.id, { onDelete: "cascade" }),

	// What service/resource this usage is for
	type: usageType("type").notNull(),

	// Resource identifier (app ID, compose ID, etc.)
	resourceId: text("resource_id"),
	resourceName: text("resource_name"),
	resourceType: text("resource_type"), // application, compose, ai_model

	// Usage metrics
	quantity: decimal("quantity", { precision: 20, scale: 6 }).notNull(),
	unit: text("unit").notNull(), // hours, tokens, gb, requests

	// Cost calculation
	unitPrice: integer("unit_price").notNull(), // price per unit in cents
	totalCost: integer("total_cost").notNull(), // total cost in cents

	// Usage period
	periodStart: timestamp("period_start").notNull(),
	periodEnd: timestamp("period_end").notNull(),

	// Additional details
	metadata: jsonb("metadata").$type<{
		// For compute
		cpuHours?: number;
		memoryGbHours?: number;
		containerId?: string;
		serverName?: string;
		// For AI
		modelName?: string;
		inputTokens?: number;
		outputTokens?: number;
		apiCalls?: number;
		provider?: string; // dashscope, openai, etc.
	}>(),

	// Has this been billed?
	billed: boolean("billed").default(false),
	billedAt: timestamp("billed_at"),
	transactionId: text("transaction_id"),

	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const usageRecordRelations = relations(usageRecord, ({ one }) => ({
	organizationBilling: one(organizationBilling, {
		fields: [usageRecord.organizationBillingId],
		references: [organizationBilling.id],
	}),
}));

// Invoices - Monthly billing summaries
export const invoice = pgTable("invoice", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationBillingId: text("organization_billing_id")
		.notNull()
		.references(() => organizationBilling.id, { onDelete: "cascade" }),

	// Invoice number (human readable)
	invoiceNumber: text("invoice_number").notNull().unique(),

	status: invoiceStatus("status").notNull().default("draft"),

	// Billing period
	periodStart: timestamp("period_start").notNull(),
	periodEnd: timestamp("period_end").notNull(),

	// Amounts in cents
	subtotal: integer("subtotal").notNull().default(0),
	tax: integer("tax").notNull().default(0),
	total: integer("total").notNull().default(0),

	// Payment details
	paidAmount: integer("paid_amount").default(0),
	paidAt: timestamp("paid_at"),
	paymentMethod: text("payment_method"),
	paymentReference: text("payment_reference"),

	// Line items breakdown
	lineItems: jsonb("line_items").$type<Array<{
		description: string;
		type: string;
		quantity: number;
		unit: string;
		unitPrice: number;
		total: number;
		resourceId?: string;
	}>>().default([]),

	// Due date
	dueDate: timestamp("due_date"),

	// Notes
	notes: text("notes"),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const invoiceRelations = relations(invoice, ({ one }) => ({
	organizationBilling: one(organizationBilling, {
		fields: [invoice.organizationBillingId],
		references: [organizationBilling.id],
	}),
}));

// Payment Methods - Store crypto addresses and wire details for Hanzo (where to pay)
export const paymentInstructions = pgTable("payment_instructions", {
	id: text("id")
		.primaryKey()
		.$defaultFn(() => nanoid()),

	// Payment method type
	type: text("type").notNull(), // crypto_eth, crypto_btc, crypto_usdc, wire_usd, wire_eur

	// Display name
	name: text("name").notNull(),

	// Is this method active?
	active: boolean("active").default(true),

	// Instructions/details
	instructions: jsonb("instructions").$type<{
		// For crypto
		address?: string;
		network?: string;
		memo?: string;
		qrCode?: string;
		minAmount?: number;
		confirmations?: number;
		// For wire
		bankName?: string;
		accountName?: string;
		accountNumber?: string;
		routingNumber?: string;
		swiftCode?: string;
		iban?: string;
		bankAddress?: string;
		reference?: string;
	}>().notNull(),

	// Display order
	sortOrder: integer("sort_order").default(0),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
