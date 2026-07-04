/**
 * Brand resolution + per-org brand write — the DATA that kills the console's
 * hardcoded `BRANDS`/`HOST_BRANDS` map.
 *
 * `resolveBrandByHost(host)` answers `GET /v1/brand?host=` FROM DATA:
 *   whitelabel_domain (host → org) + organization (name/logo/slug) + org_brand
 *   (brandName/iamUrl/iamApp/logo/favicon/accent). Returns the exact
 *   `TenantBrandConfig` the console's `TenantsApi.brandConfig` normalizer reads
 *   (`{org, brandName, logoUrl, faviconUrl, iamUrl, iamApp, accentColor}` — the
 *   normalizer keys on `org`, falling back to `iamOrgName`).
 *
 * `writeOrgBrand(org, input)` / `getOrgBrand(org)` are the per-org brand store
 * (`org_brand`), the per-org replacement for the Dokploy global `webServerSettings`
 * singleton. `provisionPackage` and `PUT /v1/org/{org}/brand` write through here.
 *
 * One way, DRY: every brand fact is a row; nothing is special-cased in code.
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
	type OrgBrand,
	orgBrands,
	organization,
	whitelabelDomains,
} from "../../db/schema";
import { normalizeHost } from "./logic";

/** The brand config shape the console consumes (`TenantBrandConfig`). */
export interface BrandConfig {
	/** Tenant org slug (the console normalizer requires this or `iamOrgName`). */
	org: string;
	brandName: string;
	logoUrl?: string;
	faviconUrl?: string;
	iamUrl?: string;
	iamApp?: string;
	iamOrgName?: string;
	accentColor?: string;
}

/**
 * Resolve the brand for a request host purely from data.
 *
 * Returns `null` when the host is not bound to any org (the console then falls
 * back to its build-time default — never a wrong brand). A bound host always
 * resolves to at least the org's own name/slug, enriched by `org_brand`.
 */
export async function resolveBrandByHost(
	host: string,
): Promise<BrandConfig | null> {
	const h = normalizeHost(host);
	if (!h) return null;

	const [binding] = await db
		.select()
		.from(whitelabelDomains)
		.where(eq(whitelabelDomains.host, h))
		.limit(1);
	if (!binding) return null;

	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.id, binding.organizationId))
		.limit(1);
	if (!org) return null;

	const [brand] = await db
		.select()
		.from(orgBrands)
		.where(eq(orgBrands.organizationId, org.id))
		.limit(1);

	const slug = org.slug ?? org.id;
	return {
		org: slug,
		brandName: brand?.brandName || org.name || slug,
		logoUrl: brand?.logoUrl || org.logo || undefined,
		faviconUrl: brand?.faviconUrl || undefined,
		iamUrl: brand?.iamUrl || undefined,
		iamApp: brand?.iamApp || undefined,
		iamOrgName: brand?.iamOrgName || slug,
		accentColor: brand?.accentColor || undefined,
	};
}

/** Read the raw per-org brand row (or null). */
export async function getOrgBrand(
	organizationId: string,
): Promise<OrgBrand | null> {
	const rows = await db
		.select()
		.from(orgBrands)
		.where(eq(orgBrands.organizationId, organizationId))
		.limit(1);
	return rows[0] ?? null;
}

/** Fields a brand write may set. `appName` is an alias for `brandName`. */
export interface BrandWriteInput {
	brandName?: string | null;
	appName?: string | null;
	iamUrl?: string | null;
	iamOrgName?: string | null;
	iamApp?: string | null;
	logoUrl?: string | null;
	faviconUrl?: string | null;
	accentColor?: string | null;
}

/** Only the keys that map onto a column (drop transport-only fields). */
function brandColumns(input: BrandWriteInput) {
	const brandName = input.brandName ?? input.appName ?? undefined;
	const out: Partial<OrgBrand> = {};
	if (brandName !== undefined) out.brandName = brandName;
	if (input.iamUrl !== undefined) out.iamUrl = input.iamUrl;
	if (input.iamOrgName !== undefined) out.iamOrgName = input.iamOrgName;
	if (input.iamApp !== undefined) out.iamApp = input.iamApp;
	if (input.logoUrl !== undefined) out.logoUrl = input.logoUrl;
	if (input.faviconUrl !== undefined) out.faviconUrl = input.faviconUrl;
	if (input.accentColor !== undefined) out.accentColor = input.accentColor;
	return out;
}

/**
 * Upsert the per-org brand. Idempotent: creates the org's brand row on first
 * write, patches only the provided fields thereafter. Applies the brand the
 * package/board sets, so `resolveBrandByHost` reflects it immediately.
 */
export async function writeOrgBrand(
	organizationId: string,
	input: BrandWriteInput,
): Promise<OrgBrand> {
	const cols = brandColumns(input);
	const existing = await getOrgBrand(organizationId);
	if (existing) {
		const [updated] = await db
			.update(orgBrands)
			.set({ ...cols, updatedAt: new Date() })
			.where(eq(orgBrands.organizationId, organizationId))
			.returning();
		return updated!;
	}
	const [created] = await db
		.insert(orgBrands)
		.values({ organizationId, ...cols })
		.returning();
	return created!;
}
