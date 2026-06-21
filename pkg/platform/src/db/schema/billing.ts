import { relations } from "drizzle-orm";
import { real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";
import { doksCluster } from "./doks-cluster";

export interface CostItem {
	type: "nodes" | "control_plane" | "ha_control_plane";
	pool?: string;
	size?: string;
	count?: number;
	unitPrice?: number;
	monthlyTotal: number;
	vcpus?: number;
	memoryMb?: number;
	diskGb?: number;
}

export const billingRecord = sqliteTable("billing_record", {
	billingId: text("billingId")
		.notNull()
		.primaryKey()
		.$defaultFn(() => nanoid()),
	organizationId: text("organizationId")
		.notNull()
		.references(() => organization.id, { onDelete: "cascade" }),
	doksClusterId: text("doksClusterId").references(
		() => doksCluster.doksClusterId,
		{ onDelete: "set null" },
	),
	monthlyTotal: real("monthlyTotal").notNull().default(0),
	subtotal: real("subtotal").notNull().default(0),
	markup: real("markup").notNull().default(0),
	markupPercent: real("markupPercent").notNull().default(0),
	currency: text("currency").notNull().default("USD"),
	calculatedAt: text("calculatedAt")
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	items: text("items", { mode: "json" })
		.$type<CostItem[]>()
		.notNull()
		.default([]),
});

export const billingRecordRelations = relations(billingRecord, ({ one }) => ({
	organization: one(organization, {
		fields: [billingRecord.organizationId],
		references: [organization.id],
	}),
	cluster: one(doksCluster, {
		fields: [billingRecord.doksClusterId],
		references: [doksCluster.doksClusterId],
	}),
}));

// --- Zod validation schemas ---

const createBillingSchema = createInsertSchema(billingRecord, {
	billingId: z.string().min(1),
	organizationId: z.string().min(1),
});

export const apiGetOrgBilling = z.object({
	organizationId: z.string().min(1),
});

export const apiGetFleetBilling = z.object({}).optional();
