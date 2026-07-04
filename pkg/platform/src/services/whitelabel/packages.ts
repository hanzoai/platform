/**
 * Package catalog service — the read/write over the `package` table that backs
 * `GET /v1/packages` (the console board's `TenantsApi.packages()`).
 *
 * The catalog is DATA: `listPackages()` reads rows, `upsertPackage()` writes one
 * (used by the boot seed and any future admin write). Adding a package is a ROW,
 * never a code change.
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
	type NewPackage,
	type Package,
	packages,
} from "../../db/schema";

/** List the full package catalog (stable order by id). */
export async function listPackages(): Promise<Package[]> {
	const rows = await db.select().from(packages);
	return rows.sort((a, b) => a.id.localeCompare(b.id));
}

/** Fetch one package by id (or null). */
export async function findPackage(id: string): Promise<Package | null> {
	const rows = await db
		.select()
		.from(packages)
		.where(eq(packages.id, id))
		.limit(1);
	return rows[0] ?? null;
}

/** Upsert a catalog package by id (idempotent — the seed loader uses this). */
export async function upsertPackage(input: NewPackage): Promise<Package> {
	const existing = await findPackage(input.id);
	if (existing) {
		const [updated] = await db
			.update(packages)
			.set({
				name: input.name,
				description: input.description ?? null,
				services: input.services,
				brandTemplate: input.brandTemplate,
				iamTemplate: input.iamTemplate,
				domainPattern: input.domainPattern,
				plan: input.plan ?? "starter",
				sovereign: input.sovereign ?? false,
				updatedAt: new Date(),
			})
			.where(eq(packages.id, input.id))
			.returning();
		return updated!;
	}
	const [created] = await db.insert(packages).values(input).returning();
	return created!;
}
