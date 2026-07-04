/**
 * White-label foundation seed — runs at boot (idempotent upserts).
 *
 *   - packages:          the canonical catalog `GET /v1/packages` serves.
 *   - service templates: the deploy-by-name map provisionPackage uses.
 *   - existing brands:   hanzo/lux/zoo/pars as tenant records (org_brand +
 *     whitelabel_domain bindings) so `GET /v1/brand?host=` returns them FROM
 *     DATA — the first rows, not special-cased code.
 *
 * The brand seed only enriches orgs that ALREADY exist (by slug) — it never
 * fabricates an owner-less org (the console bootstraps hanzo/lux/zoo/pars in the
 * platform DB). A missing org is skipped and reported (honest), not invented.
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
	organization,
	whitelabelDomains,
} from "../../db/schema";
import { writeOrgBrand } from "./brand";
import { normalizeHost } from "./logic";
import { upsertPackage } from "./packages";
import { SEED_BRANDS, SEED_PACKAGES, SEED_SERVICE_TEMPLATES } from "./seed-data";
import { upsertServiceTemplate } from "./service-registry";

export interface SeedReport {
	packages: number;
	serviceTemplates: number;
	brandsSeeded: string[];
	brandsSkipped: string[];
	domainsBound: number;
}

/** Bind a host → org record directly (no ingress/DNS side effects at seed time). */
async function seedDomainRecord(
	host: string,
	organizationId: string,
): Promise<boolean> {
	const h = normalizeHost(host);
	const [existing] = await db
		.select()
		.from(whitelabelDomains)
		.where(eq(whitelabelDomains.host, h))
		.limit(1);
	if (existing) {
		if (existing.organizationId !== organizationId) {
			await db
				.update(whitelabelDomains)
				.set({ organizationId, updatedAt: new Date() })
				.where(eq(whitelabelDomains.host, h));
		}
		return false;
	}
	await db.insert(whitelabelDomains).values({
		host: h,
		organizationId,
		serviceName: "console",
		// These hosts are already served by existing (hand-made or operator)
		// ingresses — the seed only records the host→org binding so the brand
		// resolver works; it does NOT re-provision an ingress for a live host.
		status: "active",
		ingressCreated: false,
		dnsCreated: false,
	});
	return true;
}

export async function seedWhitelabelFoundation(): Promise<SeedReport> {
	const report: SeedReport = {
		packages: 0,
		serviceTemplates: 0,
		brandsSeeded: [],
		brandsSkipped: [],
		domainsBound: 0,
	};

	// 1. Package catalog.
	for (const pkg of SEED_PACKAGES) {
		await upsertPackage(pkg);
		report.packages += 1;
	}

	// 2. Service templates.
	for (const t of SEED_SERVICE_TEMPLATES) {
		await upsertServiceTemplate({
			id: t.id,
			name: t.name,
			repo: t.repo ?? null,
			image: t.image ?? null,
			defaultTag: t.defaultTag ?? null,
			port: t.port ?? 3000,
			deployable: t.deployable ?? true,
			buildRequired: t.buildRequired ?? false,
		});
		report.serviceTemplates += 1;
	}

	// 3. Existing brands → tenant records (only for orgs that already exist).
	for (const brand of SEED_BRANDS) {
		const [org] = await db
			.select()
			.from(organization)
			.where(eq(organization.slug, brand.slug))
			.limit(1);
		if (!org) {
			report.brandsSkipped.push(brand.slug);
			continue;
		}
		await writeOrgBrand(org.id, {
			brandName: brand.brandName,
			iamUrl: brand.iamUrl,
			iamOrgName: brand.slug,
			iamApp: brand.iamApp,
			logoUrl: brand.logoUrl ?? null,
			accentColor: brand.accentColor ?? null,
		});
		for (const host of brand.hosts) {
			if (await seedDomainRecord(host, org.id)) report.domainsBound += 1;
		}
		report.brandsSeeded.push(brand.slug);
	}

	return report;
}
