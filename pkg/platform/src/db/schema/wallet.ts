import { relations } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { organization } from "./account";
import { applications } from "./application";
import { user } from "./user";

export const organizationWallet = sqliteTable(
	"organization_wallet",
	{
		walletId: text("wallet_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.unique()
			.references(() => organization.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		balance: text("balance").notNull().default("0"),
		monthlyCredits: text("monthly_credits").notNull().default("0"),
		purchasedCredits: text("purchased_credits").notNull().default("0"),
		plan: text("plan").notNull().default("hobby"),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		subscriptionStatus: text("subscription_status").notNull().default("active"),
		autoTopupEnabled: integer("auto_topup_enabled", { mode: "boolean" })
			.notNull()
			.default(false),
		autoTopupThreshold: text("auto_topup_threshold"),
		autoTopupAmount: text("auto_topup_amount"),
		autoTopupLastTriggered: integer("auto_topup_last_triggered", {
			mode: "timestamp_ms",
		}),
		cycleStart: integer("cycle_start", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		cycleEnd: integer("cycle_end", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		orgIdIdx: index("idx_org_wallet_org_id").on(table.organizationId),
		ownerIdIdx: index("idx_org_wallet_owner").on(table.ownerId),
	}),
);

export const walletTransactions = sqliteTable(
	"wallet_transactions",
	{
		transactionId: text("transaction_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		walletId: text("wallet_id")
			.notNull()
			.references(() => organizationWallet.walletId, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		amount: text("amount").notNull(),
		balanceBefore: text("balance_before").notNull(),
		balanceAfter: text("balance_after").notNull(),
		stripePaymentIntentId: text("stripe_payment_intent_id"),
		description: text("description"),
		applicationId: text("application_id"),
		aiRequestId: text("ai_request_id"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		walletIdIdx: index("idx_wallet_tx_wallet").on(table.walletId),
		orgIdIdx: index("idx_wallet_tx_org").on(table.organizationId),
	}),
);

export const appUsageMetrics = sqliteTable(
	"app_usage_metrics",
	{
		metricId: text("metric_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		applicationId: text("application_id")
			.notNull()
			.references(() => applications.applicationId, { onDelete: "cascade" }),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		ownerId: text("owner_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		periodStart: integer("period_start", { mode: "timestamp_ms" }).notNull(),
		periodEnd: integer("period_end", { mode: "timestamp_ms" }).notNull(),
		durationSeconds: integer("duration_seconds").notNull(),
		cpuSeconds: text("cpu_seconds").notNull(),
		memoryGbSeconds: text("memory_gb_seconds").notNull(),
		storageGbSeconds: text("storage_gb_seconds").notNull(),
		egressGb: text("egress_gb").notNull(),
		cpuCost: text("cpu_cost").notNull(),
		memoryCost: text("memory_cost").notNull(),
		storageCost: text("storage_cost").notNull(),
		egressCost: text("egress_cost").notNull(),
		totalCost: text("total_cost").notNull(),
		charged: integer("charged", { mode: "boolean" }).notNull().default(false),
		chargedAt: integer("charged_at", { mode: "timestamp_ms" }),
		transactionId: text("transaction_id").references(
			() => walletTransactions.transactionId,
			{ onDelete: "set null" },
		),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		appIdIdx: index("idx_app_usage_app").on(table.applicationId),
		orgIdIdx: index("idx_app_usage_org").on(table.organizationId),
		unchargedIdx: index("idx_app_usage_uncharged").on(table.charged),
	}),
);

export const aiUsageMetrics = sqliteTable(
	"ai_usage_metrics",
	{
		metricId: text("metric_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		requestId: text("request_id").notNull().unique(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		applicationId: text("application_id"),
		provider: text("provider").notNull(),
		model: text("model").notNull(),
		endpoint: text("endpoint").notNull(),
		byok: integer("byok", { mode: "boolean" }).notNull().default(false),
		promptTokens: integer("prompt_tokens").notNull().default(0),
		completionTokens: integer("completion_tokens").notNull().default(0),
		totalTokens: integer("total_tokens").notNull().default(0),
		providerCost: text("provider_cost").notNull(),
		cost: text("cost").notNull(),
		charged: integer("charged", { mode: "boolean" }).notNull().default(false),
		chargedAt: integer("charged_at", { mode: "timestamp_ms" }),
		transactionId: text("transaction_id").references(
			() => walletTransactions.transactionId,
			{ onDelete: "set null" },
		),
		requestDurationMs: integer("request_duration_ms"),
		errorOccurred: integer("error_occurred", { mode: "boolean" })
			.notNull()
			.default(false),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		orgIdIdx: index("idx_ai_usage_org").on(table.organizationId),
		unchargedIdx: index("idx_ai_usage_uncharged").on(table.charged),
	}),
);

export const balanceAlertHistory = sqliteTable(
	"balance_alert_history",
	{
		alertId: text("alert_id")
			.$defaultFn(() => crypto.randomUUID())
			.primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		alertType: text("alert_type").notNull(),
		balanceAtAlert: text("balance_at_alert").notNull(),
		threshold: text("threshold"),
		sentAt: integer("sent_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		userIdIdx: index("idx_balance_alerts_user").on(table.userId),
	}),
);

export const organizationWalletRelations = relations(
	organizationWallet,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [organizationWallet.organizationId],
			references: [organization.id],
		}),
		owner: one(user, {
			fields: [organizationWallet.ownerId],
			references: [user.id],
		}),
		transactions: many(walletTransactions),
	}),
);

export const walletTransactionsRelations = relations(
	walletTransactions,
	({ one }) => ({
		wallet: one(organizationWallet, {
			fields: [walletTransactions.walletId],
			references: [organizationWallet.walletId],
		}),
		organization: one(organization, {
			fields: [walletTransactions.organizationId],
			references: [organization.id],
		}),
	}),
);

export const appUsageMetricsRelations = relations(
	appUsageMetrics,
	({ one }) => ({
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
	}),
);

export type OrganizationWallet = typeof organizationWallet.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type AppUsageMetric = typeof appUsageMetrics.$inferSelect;
export type AiUsageMetric = typeof aiUsageMetrics.$inferSelect;
