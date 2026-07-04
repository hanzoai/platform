/**
 * Service registry — the data-driven service-NAME → deploy-template lookup that
 * lets `provisionPackage` deploy a package's services by name.
 *
 * A package lists service names; this resolves each to its repo/image/port and
 * whether it is a deployable tenant workload. The mapping is a ROW
 * (`service_template`), never code — adding a deployable service is an INSERT.
 *
 * HONEST: a service with NO template resolves to `null`, and provisionPackage
 * records it `pending` (never a faked "provisioned").
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
	type NewServiceTemplate,
	type ServiceTemplate,
	serviceTemplates,
} from "../../db/schema";

/** Resolve a service name to its deploy template (or null if none exists). */
export async function resolveServiceTemplate(
	serviceName: string,
): Promise<ServiceTemplate | null> {
	const rows = await db
		.select()
		.from(serviceTemplates)
		.where(eq(serviceTemplates.id, serviceName))
		.limit(1);
	return rows[0] ?? null;
}

/** List all service templates. */
export async function listServiceTemplates(): Promise<ServiceTemplate[]> {
	return db.select().from(serviceTemplates);
}

/** Upsert a service template by id (the seed loader uses this). */
export async function upsertServiceTemplate(
	input: NewServiceTemplate,
): Promise<ServiceTemplate> {
	const existing = await resolveServiceTemplate(input.id);
	if (existing) {
		const [updated] = await db
			.update(serviceTemplates)
			.set({
				name: input.name,
				repo: input.repo ?? null,
				image: input.image ?? null,
				defaultTag: input.defaultTag ?? null,
				port: input.port ?? 3000,
				deployable: input.deployable ?? true,
				buildRequired: input.buildRequired ?? false,
				updatedAt: new Date(),
			})
			.where(eq(serviceTemplates.id, input.id))
			.returning();
		return updated!;
	}
	const [created] = await db
		.insert(serviceTemplates)
		.values(input)
		.returning();
	return created!;
}
