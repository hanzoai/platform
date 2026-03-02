import { relations } from "drizzle-orm";
import { boolean, index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { organization } from "./account";
import { user } from "./user";
import { applications } from "./application";

export const organizationWallet = pgTable(
	"organization_wallet",
	{
		walletId: uuid("wallet_id").defaultRandom().primaryKey(),
		organizationId: text("organization_id").notNull().unique().references(() => organization.id, { onDelete: "cascade" }),
		ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
		monthlyCredits: numeric("monthly_credits", { precision: 10, scale: 2 }).notNull().default("0"),
		purchasedCredits: numeric("purchased_credits", { precision: 10, scale: 2 }).notNull().default("0"),
		plan: text("plan").notNull().default("hobby"),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		subscriptionStatus: text("subscription_status").notNull().default("active"),
		autoTopupEnabled: boolean("auto_topup_enabled").notNull().default(false),
		autoTopupThreshold: numeric("auto_topup_threshold", { precision: 10, scale: 2 }),
		autoTopupAmount: numeric("auto_topup_amount", { precision: 10, scale: 2 }),
		autoTopupLastTriggered: timestamp("auto_topup_last_triggered", { withTimezone: true }),
		cycleStart: timestamp("cycle_start", { withTimezone: true }).notNull().defaultNow(),
		cycleEnd: timestamp("cycle_end", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		orgIdIdx: index("idx_org_wallet_org_id").on(table.organizationId),
		ownerIdIdx: index("idx_org_wallet_owner").on(table.ownerId),
	}),
);

export const walletTransactions = pgTable(
	"wallet_transactions",
	{
		transactionId: uuid("transaction_id").defaultRandom().primaryKey(),
		walletId: uuid("wallet_id").notNull().references(() => organizationWallet.walletId, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
		balanceBefore: numeric("balance_before", { precision: 10, scale: 2 }).notNull(),
		balanceAfter: numeric("balance_after", { precision: 10, scale: 2 }).notNull(),
		stripePaymentIntentId: text("stripe_payment_intent_id"),
		description: text("description"),
		applicationId: text("application_id"),
		aiRequestId: text("ai_request_id"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		walletIdIdx: index("idx_wallet_tx_wallet").on(table.walletId),
		orgIdIdx: index("idx_wallet_tx_org").on(table.organizationId),
	}),
);

export const appUsageMetrics = pgTable(
	"app_usage_metrics",
	{
		metricId: uuid("metric_id").defaultRandom().primaryKey(),
		applicationId: text("application_id").notNull().references(() => applications.applicationId, { onDelete: "cascade" }),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		ownerId: text("owner_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
		periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		cpuSeconds: numeric("cpu_seconds", { precision: 12, scale: 6 }).notNull(),
		memoryGbSeconds: numeric("memory_gb_seconds", { precision: 12, scale: 6 }).notNull(),
		storageGbSeconds: numeric("storage_gb_seconds", { precision: 12, scale: 6 }).notNull(),
		egressGb: numeric("egress_gb", { precision: 12, scale: 6 }).notNull(),
		cpuCost: numeric("cpu_cost", { precision: 10, scale: 6 }).notNull(),
		memoryCost: numeric("memory_cost", { precision: 10, scale: 6 }).notNull(),
		storageCost: numeric("storage_cost", { precision: 10, scale: 6 }).notNull(),
		egressCost: numeric("egress_cost", { precision: 10, scale: 6 }).notNull(),
		totalCost: numeric("total_cost", { precision: 10, scale: 6 }).notNull(),
		charged: boolean("charged").notNull().default(false),
		chargedAt: timestamp("charged_at", { withTimezone: true }),
		transactionId: uuid("transaction_id").references(() => walletTransactions.transactionId, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		appIdIdx: index("idx_app_usage_app").on(table.applicationId),
		orgIdIdx: index("idx_app_usage_org").on(table.organizationId),
		unchargedIdx: index("idx_app_usage_uncharged").on(table.charged),
	}),
);

export const aiUsageMetrics = pgTable(
	"ai_usage_metrics",
	{
		metricId: uuid("metric_id").defaultRandom().primaryKey(),
		requestId: text("request_id").notNull().unique(),
		organizationId: text("organization_id").notNull().references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		applicationId: text("application_id"),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		endpoint: text("endpoint").notNull(),
		byok: boolean("byok").notNull().default(false),
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		totalTokens: integer("total_tokens").notNull().default(0),
		providerCost: numeric("provider_cost", { precision: 10, scale: 6 }).notNull(),
		cost: numeric("cost", { precision: 10, scale: 6 }).notNull(),
		charged: boolean("charged").notNull().default(false),
		chargedAt: timestamp("charged_at", { withTimezone: true }),
		transactionId: uuid("transaction_id").references(() => walletTransactions.transactionId, { onDelete: "set null" }),
		requestDurationMs: integer("request_duration_ms"),
		errorOccurred: boolean("error_occurred").notNull().default(false),
		errorMessage: text("error_message"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		orgIdIdx: index("idx_ai_usage_org").on(table.organizationId),
		unchargedIdx: index("idx_ai_usage_uncharged").on(table.charged),
	}),
);

export const balanceAlertHistory = pgTable(
	"balance_alert_history",
	{
		alertId: uuid("alert_id").defaultRandom().primaryKey(),
		userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
		alertType: text("alert_type").notNull(),
		balanceAtAlert: numeric("balance_at_alert", { precision: 10, scale: 2 }).notNull(),
		threshold: numeric("threshold", { precision: 10, scale: 2 }),
		sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => ({
		userIdIdx: index("idx_balance_alerts_user").on(table.userId),
	}),
);

export const organizationWalletRelations = relations(organizationWallet, ({ one, many }) => ({
	organization: one(organization, {
		fields: [organizationWallet.organizationId],
		references: [organization.id],
	}),
	owner: one(user, {
		fields: [organizationWallet.ownerId],
		references: [user.id],
	}),
	transactions: many(walletTransactions),
}));

export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
	wallet: one(organizationWallet, {
		fields: [walletTransactions.walletId],
		references: [organizationWallet.walletId],
	}),
	organization: one(organization, {
		fields: [walletTransactions.organizationId],
		references: [organization.id],
	}),
}));

export const appUsageMetricsRelations = relations(appUsageMetrics, ({ one }) => ({
	application: one(applications, {
		fields: [appUsageMetrics.applicationId],
		references: [applications.applicationId],
	}),
	organization: one(organization, {
		fields: [appUsageMetrics.organizationId],
		references: [organization.id],
	}),
	owner: one(user, {
		fields: [appUsageMetrics.ownerId],
		references: [user.id],
	}),
}));

export type OrganizationWallet = typeof organizationWallet.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type AppUsageMetric = typeof appUsageMetrics.$inferSelect;
export type AiUsageMetric = typeof aiUsageMetrics.$inferSelect;
