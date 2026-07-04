import { relations } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { nanoid } from "nanoid";
import { z } from "zod";
import { organization } from "./account";

/**
 * whitelabel_domain — the white-label host → org binding.
 *
 * The reseller foundation's host binding: one row per custom host bound to an
 * org. `POST /v1/org/{org}/domain` binds a host → auto-creates the ingress
 * (route host → the console/service), the DNS record, and the cert, then stores
 * the binding here. `GET /v1/org/{org}/domain` lists them. The routed-host set
 * DERIVES from these rows (there is no hardcoded host list anywhere).
 *
 * This is DISTINCT from the Dokploy `domain` table (`schema/domain.ts`, symbol
 * `domains`), which binds a host to a Traefik application/compose/preview inside
 * a project. That one is per-application router config; THIS one is the
 * tenant-level "which host belongs to which org and what does it route to" map
 * that also powers `GET /v1/brand?host=`. One concept, one table — no overlap.
 *
 * Binding a host here REPLACES the hand-made ingresses (console-admin-lux-network,
 * console-admin-zoo-cloud): the bind auto-provisions the ingress+DNS+cert, so
 * those throwaway ones can be deleted once a bind is verified.
 */

/** Provisioning lifecycle of a host binding. */
export const domainBindingStatusValues = [
	/** the binding row exists; ingress/DNS/cert not yet applied. */
	"pending",
	/** ingress + DNS + cert all applied. */
	"active",
	/** applying the ingress/DNS/cert failed (see `error`). */
	"error",
] as const;

export const whitelabelDomains = sqliteTable(
	"whitelabel_domain",
	{
		id: text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => nanoid()),
		/** The bound host, e.g. `console.acme.hanzo.app` (unique across the estate). */
		host: text("host").notNull(),
		/** Owning org (the tenant this host routes to / brands as). */
		organizationId: text("organizationId")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		/** In-cluster service name the ingress routes this host to, e.g. `console`. */
		serviceName: text("serviceName").notNull().default("console"),
		/** Service port the ingress backends to. */
		port: integer("port").notNull().default(3000),
		/** Whether the ingress terminates TLS (letsencrypt cert via cert-manager). */
		https: integer("https", { mode: "boolean" }).notNull().default(true),
		/** Namespace the ingress is created in (the org tenant ns or `hanzo`). */
		namespace: text("namespace").notNull().default("hanzo"),
		/** Cluster the ingress lives on, e.g. `hanzo-k8s`. */
		cluster: text("cluster").notNull().default("hanzo-k8s"),
		status: text("status", { enum: domainBindingStatusValues })
			.notNull()
			.default("pending"),
		/** Whether the DNS record was created (Cloudflare/Hanzo DNS). */
		dnsCreated: integer("dnsCreated", { mode: "boolean" })
			.notNull()
			.default(false),
		/** Whether the ingress object was created. */
		ingressCreated: integer("ingressCreated", { mode: "boolean" })
			.notNull()
			.default(false),
		/** The k8s Ingress name that was created (for teardown). */
		ingressName: text("ingressName"),
		/** Non-fatal provisioning detail / last error. */
		error: text("error"),
		/** The grant this host was bound for, when created by provisionPackage. */
		tenantPackageId: text("tenantPackageId"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(table) => ({
		/** A host binds to exactly one org — the brand resolver keys on host. */
		whitelabelDomainHostUnique: uniqueIndex("whitelabel_domain_host_unique").on(
			table.host,
		),
	}),
);

export const whitelabelDomainsRelations = relations(
	whitelabelDomains,
	({ one }) => ({
		organization: one(organization, {
			fields: [whitelabelDomains.organizationId],
			references: [organization.id],
		}),
	}),
);

const createSchema = createInsertSchema(whitelabelDomains, {
	host: z.string().min(1),
	organizationId: z.string().min(1),
	serviceName: z.string().min(1),
});

/** Bind-domain request (mirrors the board's `bindDomain` body). */
export const apiBindDomain = z.object({
	host: z.string().min(1),
	serviceName: z.string().min(1).optional(),
	port: z.number().int().positive().optional(),
	https: z.boolean().optional(),
	certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
	namespace: z.string().min(1).optional(),
	cluster: z.string().min(1).optional(),
});

export type WhitelabelDomain = typeof whitelabelDomains.$inferSelect;
export type NewWhitelabelDomain = typeof whitelabelDomains.$inferInsert;
