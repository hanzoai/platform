import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * service_template — the data-driven SERVICE → deploy-template catalog.
 *
 * A package's `services` list carries names (`console-admin`, `paas`, `dex`,
 * `ats`, `bd`, `ta`, `chain`, `iam`, `kms`). To DEPLOY a service by name, the
 * platform must know its repo, image, port, and default plan tier. That mapping
 * is DATA (a row here), never code — adding a deployable service is an INSERT,
 * exactly like adding a package.
 *
 * `provisionPackage` looks up each of a package's services here:
 *   - a service WITH a template → deploy it for real (build if needed →
 *     operator Service CR in the org's tenant namespace).
 *   - a service WITHOUT a template → recorded `pending` in the grant's
 *     `serviceStatuses` (HONEST — never faked "provisioned").
 *
 * `iam`/`kms` are identity/secret concerns handled by the IAM-scope + KMS steps
 * of provisioning, not deployed as tenant workloads — they are marked
 * `deployable=false` so provisionPackage records them satisfied-by-scope rather
 * than trying to stand up a per-tenant copy.
 */
export const serviceTemplates = sqliteTable("service_template", {
	/** Service name as it appears in a package's `services` list, e.g. `dex`. */
	id: text("id").notNull().primaryKey(),
	/** Display name, e.g. `DEX`. */
	name: text("name").notNull(),
	/** `owner/repo` the image is built from, e.g. `hanzoai/dex`. */
	repo: text("repo"),
	/** Image base to deploy, e.g. `ghcr.io/hanzoai/dex`. */
	image: text("image"),
	/** Default image tag to deploy (semver, e.g. `v1.0.0`). */
	defaultTag: text("defaultTag"),
	/** Container/service port. */
	port: integer("port").notNull().default(3000),
	/**
	 * Whether this service stands up as a tenant workload (operator Service CR).
	 * `iam`/`kms` are false — satisfied by the IAM-scope / KMS provisioning steps.
	 */
	deployable: integer("deployable", { mode: "boolean" }).notNull().default(true),
	/**
	 * Whether the image must be BUILT first (arcd BuildKit) before deploy. When
	 * false, the `image:defaultTag` is deployed directly (already published).
	 */
	buildRequired: integer("buildRequired", { mode: "boolean" })
		.notNull()
		.default(false),
	createdAt: integer("created_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.notNull()
		.$defaultFn(() => new Date()),
});

const createSchema = createInsertSchema(serviceTemplates, {
	id: z.string().min(1),
	name: z.string().min(1),
});

export const apiUpsertServiceTemplate = createSchema.pick({
	id: true,
	name: true,
	repo: true,
	image: true,
	defaultTag: true,
	port: true,
	deployable: true,
	buildRequired: true,
});

export type ServiceTemplate = typeof serviceTemplates.$inferSelect;
export type NewServiceTemplate = typeof serviceTemplates.$inferInsert;
