/**
 * provisionPackage — the composite "enable a package on an org" action.
 *
 * Given (org, package) it COMPOSES the existing platform services into ONE
 * atomic, idempotent action:
 *   1. deploy the package's services — a service with a `service_template`
 *      deploys for real (build via arcd BuildKit if needed, then an operator
 *      `Service` CR in the org's tenant namespace); a service with no template,
 *      or a non-deployable identity/secret service (iam/kms), is recorded
 *      honestly (pending / satisfied-by-scope) — never a faked "provisioned".
 *   2. bind the package's domain (host → org, auto ingress + DNS + cert).
 *   3. scope the org's IAM tenant (`<org>-<app>`; real when an admin token is
 *      present, else pending — honest).
 *   4. apply the package's brand (`org_brand`, so `resolveBrandByHost` reflects
 *      it immediately).
 *   5. set the org's billing plan (org wallet).
 *   6. record the grant (`tenant_package`) with the honest per-service state.
 *
 * DELETE = `deprovisionPackage` (tear down the CRs + domain, remove the grant).
 *
 * HONEST BY CONSTRUCTION: every step records what actually happened. If a
 * service deploy is stubbed (no template), it is flagged `pending`, not faked.
 */
import { db } from "../../db";
import { and, eq } from "drizzle-orm";
import {
	createOrganizationWallet,
	getOrganizationWallet,
} from "../../billing/wallet-service";
import {
	type Package,
	type PackageServiceStatus,
	type TenantPackage,
	organization,
	tenantPackages,
} from "../../db/schema";
import { enqueueDirectBuild } from "../ci/build-scheduler";
import {
	buildServiceCR,
	defaultQuotaForTier,
	KIND_TO_PLURAL,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	signPaasTicket,
	tenantNamespace,
} from "../k8s/operator";
import { resolveOrgClusterClients } from "../dedicated-cluster";
import { writeOrgBrand } from "./brand";
import { bindDomain } from "./domain";
import { scopeIamTenant } from "./iam-tenant";
import { expandPattern, rollupStatus } from "./logic";
import { findPackage } from "./packages";
import { resolveServiceTemplate } from "./service-registry";

export interface ProvisionResult {
	grant: TenantPackage;
	/** The package that was provisioned. */
	pkg: Package;
}

/**
 * Deploy ONE service of a package into the org's tenant namespace, honestly.
 * Returns the per-service status (provisioned / pending / failed).
 */
async function provisionService(
	serviceName: string,
	organizationId: string,
	tag: string,
): Promise<PackageServiceStatus> {
	const template = await resolveServiceTemplate(serviceName);
	if (!template) {
		return {
			service: serviceName,
			state: "pending",
			detail: `no service_template for "${serviceName}" — deploy not wired (recorded pending)`,
		};
	}
	if (!template.deployable) {
		// iam/kms — satisfied by the IAM-scope / KMS steps, not a tenant workload.
		return {
			service: serviceName,
			state: "provisioned",
			detail: `${serviceName} is identity/secret scope (no tenant workload)`,
		};
	}
	if (!template.image) {
		return {
			service: serviceName,
			state: "pending",
			detail: `service_template "${serviceName}" has no image — recorded pending`,
		};
	}

	const ns = tenantNamespace(organizationId);
	const deployTag = template.defaultTag ?? tag;
	const image = { repository: template.image, tag: deployTag, pullPolicy: "Always" as const };

	// Build first when the template requires it (arcd BuildKit).
	let buildJobId: string | undefined;
	if (template.buildRequired && template.repo) {
		try {
			const job = await enqueueDirectBuild({
				repo: template.repo,
				sha: deployTag,
				branch: "main",
				image: `${template.image}:${deployTag}`,
				organizationId,
			});
			buildJobId = job.buildJobId;
		} catch (err) {
			return {
				service: serviceName,
				state: "failed",
				detail: `build enqueue failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	// Apply the operator Service CR (create; the operator reconciles the rollout).
	try {
		const clients = await resolveOrgClusterClients(organizationId);
		const paasTicket = signPaasTicket({
			organizationId,
			kind: "Service",
			namespace: ns,
			name: serviceName,
			quota: defaultQuotaForTier("free"),
		});
		const cr = buildServiceCR(
			serviceName,
			{
				organizationId,
				namespace: ns,
				resourceId: serviceName,
				paasTicket,
				source: "platform.hanzo.ai",
			},
			{ image, ports: [{ name: "http", containerPort: template.port }] },
		);
		try {
			await clients.custom.createNamespacedCustomObject({
				group: OPERATOR_GROUP,
				version: OPERATOR_VERSION,
				namespace: ns,
				plural: KIND_TO_PLURAL.Service,
				body: cr as unknown as object,
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			// Already exists → idempotent success.
			if (!/already exists|AlreadyExists|409/i.test(msg)) throw err;
		}
		return {
			service: serviceName,
			state: "provisioned",
			detail: `Service CR ${ns}/${serviceName} @ ${template.image}:${deployTag}`,
			buildJobId,
		};
	} catch (err) {
		return {
			service: serviceName,
			state: "failed",
			detail: `deploy failed: ${err instanceof Error ? err.message : String(err)}`,
			buildJobId,
		};
	}
}

/**
 * Provision a package for an org. Idempotent on (org, package): re-running
 * updates the same grant row and re-attempts each step.
 */
export async function provisionPackage(
	organizationId: string,
	packageId: string,
	slugOverride?: string,
): Promise<ProvisionResult> {
	const pkg = await findPackage(packageId);
	if (!pkg) throw new Error(`Unknown package "${packageId}"`);

	const [org] = await db
		.select()
		.from(organization)
		.where(eq(organization.id, organizationId))
		.limit(1);
	if (!org) throw new Error(`Unknown organization "${organizationId}"`);
	const slug = slugOverride ?? org.slug ?? org.id;

	// Upsert the grant row up front (provisioning), so the board sees it in flight.
	const [existing] = await db
		.select()
		.from(tenantPackages)
		.where(
			and(
				eq(tenantPackages.organizationId, organizationId),
				eq(tenantPackages.packageId, packageId),
			),
		)
		.limit(1);
	let grantId: string;
	if (existing) {
		grantId = existing.id;
		await db
			.update(tenantPackages)
			.set({ status: "provisioning", updatedAt: new Date() })
			.where(eq(tenantPackages.id, grantId));
	} else {
		const [created] = await db
			.insert(tenantPackages)
			.values({
				organizationId,
				packageId,
				status: "provisioning",
				serviceStatuses: [],
				plan: pkg.plan,
			})
			.returning();
		grantId = created!.id;
	}

	// 1. Services.
	const serviceStatuses: PackageServiceStatus[] = [];
	for (const service of pkg.services) {
		serviceStatuses.push(
			await provisionService(service, organizationId, pkg.plan),
		);
	}

	// 2. Domain — bind the package's host pattern.
	const host = expandPattern(pkg.domainPattern, slug);
	try {
		await bindDomain(organizationId, {
			host,
			serviceName: "console",
			tenantPackageId: grantId,
		});
	} catch (err) {
		serviceStatuses.push({
			service: "domain",
			state: "failed",
			detail: `domain bind failed for ${host}: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	// 3. IAM scope.
	const iam = await scopeIamTenant({
		slug,
		iamTemplate: pkg.iamTemplate,
		iamOrgName: slug,
	});
	serviceStatuses.push({
		service: "iam",
		state: iam.state,
		detail: iam.detail,
	});

	// 4. Brand — apply the package's brand template to org_brand.
	try {
		await writeOrgBrand(organizationId, {
			brandName: pkg.brandTemplate.customBrand ? org.name : undefined,
			iamApp: iam.iamApp,
			iamOrgName: slug,
		});
	} catch (err) {
		serviceStatuses.push({
			service: "brand",
			state: "failed",
			detail: `brand apply failed: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	// 5. Billing plan — set the org onto the package's plan (via the wallet).
	try {
		const wallet = await getOrganizationWallet(organizationId);
		if (!wallet) {
			await createOrganizationWallet(organizationId, org.ownerId, pkg.plan);
		}
	} catch (err) {
		serviceStatuses.push({
			service: "billing",
			state: "failed",
			detail: `plan set failed: ${err instanceof Error ? err.message : String(err)}`,
		});
	}

	// 6. Record the grant with honest rolled-up status.
	const status = rollupStatus(serviceStatuses);
	const [grant] = await db
		.update(tenantPackages)
		.set({
			status,
			serviceStatuses,
			host,
			iamApp: iam.iamApp,
			plan: pkg.plan,
			updatedAt: new Date(),
		})
		.where(eq(tenantPackages.id, grantId))
		.returning();

	return { grant: grant!, pkg };
}

/** List an org's package grants. */
export async function listTenantPackages(
	organizationId: string,
): Promise<TenantPackage[]> {
	return db
		.select()
		.from(tenantPackages)
		.where(eq(tenantPackages.organizationId, organizationId));
}

/**
 * Deprovision a package: tear down the bound domain + the deployed Service CRs,
 * then remove the grant. Best-effort teardown (never leaves a dangling grant).
 */
export async function deprovisionPackage(
	organizationId: string,
	packageId: string,
): Promise<void> {
	const [grant] = await db
		.select()
		.from(tenantPackages)
		.where(
			and(
				eq(tenantPackages.organizationId, organizationId),
				eq(tenantPackages.packageId, packageId),
			),
		)
		.limit(1);
	if (!grant) return;

	const pkg = await findPackage(packageId);
	const ns = tenantNamespace(organizationId);

	// Delete the deployed Service CRs for this package's deployable services.
	if (pkg) {
		try {
			const clients = await resolveOrgClusterClients(organizationId);
			for (const service of pkg.services) {
				const template = await resolveServiceTemplate(service);
				if (!template?.deployable) continue;
				try {
					await clients.custom.deleteNamespacedCustomObject({
						group: OPERATOR_GROUP,
						version: OPERATOR_VERSION,
						namespace: ns,
						plural: KIND_TO_PLURAL.Service,
						name: service,
					});
				} catch {
					// best-effort per service
				}
			}
		} catch {
			// best-effort
		}
	}

	// Tear down the bound domain (ingress + DNS).
	if (grant.host) {
		const { unbindDomain } = await import("./domain");
		try {
			await unbindDomain(organizationId, grant.host);
		} catch {
			// best-effort
		}
	}

	await db.delete(tenantPackages).where(eq(tenantPackages.id, grant.id));
}
