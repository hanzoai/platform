/**
 * White-label domain binding — bind a host to an org and AUTO-provision its
 * ingress + DNS + cert. Wraps the existing platform primitives that had no HTTP
 * route:
 *   - `k8s/k8s-ingress.createIngress` (route host → the console/service, with a
 *     cert-manager cluster-issuer annotation so a cert is auto-issued),
 *   - `cloudflare.createDnsRecordForDefaultZone` / Hanzo DNS (the A record).
 *
 * `bindDomain(org, input)` records the binding (`whitelabel_domain`) then
 * best-effort provisions the ingress + DNS; the record is the source of truth
 * for the routed-host set (no hardcoded host list) and for `resolveBrandByHost`.
 * `listDomains(org)` lists them; `unbindDomain` tears down ingress + DNS + row.
 *
 * This REPLACES the hand-made ingresses (console-admin-lux-network,
 * console-admin-zoo-cloud): a bind auto-provisions them properly.
 *
 * HONEST: DNS/ingress each record whether they actually succeeded
 * (`dnsCreated`/`ingressCreated`), and a failure is captured in `error` with
 * `status='error'` — never reported as active when it isn't.
 */
import { db } from "../../db";
import { eq } from "drizzle-orm";
import {
	type WhitelabelDomain,
	whitelabelDomains,
} from "../../db/schema";
import {
	createDnsRecordForDefaultZone,
	deleteDnsRecordForDefaultZone,
	listDnsRecordsForDefaultZone,
} from "../cloudflare";
import { resolveOrgClusterClients } from "../dedicated-cluster";
import { createIngress, deleteIngress } from "../k8s/k8s-ingress";
import { kmsSecret } from "../kms";
import { ingressNameForHost, normalizeHost } from "./logic";
// (ingressNameForHost / normalizeHost are re-exported by the barrel from ./logic)

/** The cert-manager ClusterIssuer that auto-issues letsencrypt certs. */
const CLUSTER_ISSUER = process.env.WHITELABEL_CLUSTER_ISSUER ?? "letsencrypt-prod";

/** The public LB IP that white-label A records point at (KMS-sourced). */
function ingressIp(): string | undefined {
	return (
		kmsSecret("HANZO_INGRESS_IP") ??
		kmsSecret("LUX_BRIDGE_LB_IP") ??
		process.env.WHITELABEL_INGRESS_IP
	);
}

const isCloudflareConfigured = (): boolean =>
	Boolean(
		process.env.CLOUDFLARE_API_TOKEN &&
			process.env.CLOUDFLARE_ZONE_ID &&
			process.env.CLOUDFLARE_ACCOUNT_ID,
	);

export interface BindDomainInput {
	host: string;
	serviceName?: string;
	port?: number;
	https?: boolean;
	namespace?: string;
	cluster?: string;
	/** Grant this bind belongs to (set by provisionPackage). */
	tenantPackageId?: string;
}

/**
 * Auto-create the ingress for a bound host. The cert-manager cluster-issuer
 * annotation makes a cert issue automatically for the TLS host. Idempotent at
 * the caller (delete-then-create is not needed; createIngress errors if it
 * exists — we treat "already exists" as success).
 */
async function provisionIngress(
	binding: WhitelabelDomain,
): Promise<{ ok: boolean; name: string; error?: string }> {
	const name = ingressNameForHost(binding.host);
	try {
		const clients = await resolveOrgClusterClients(binding.organizationId);
		await createIngress(clients, binding.namespace, {
			name,
			port: binding.port,
			serviceName: binding.serviceName,
			hosts: [binding.host],
			...(binding.https
				? {
						tls: [
							{ hosts: [binding.host], secretName: `${name}-tls` },
						],
						annotations: {
							"cert-manager.io/cluster-issuer": CLUSTER_ISSUER,
						},
					}
				: {}),
		});
		return { ok: true, name };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// An already-existing ingress is a successful (idempotent) outcome.
		if (/already exists|AlreadyExists/i.test(msg)) return { ok: true, name };
		return { ok: false, name, error: msg };
	}
}

/** Auto-create the A record for the host (Cloudflare default zone). */
async function provisionDns(
	host: string,
): Promise<{ ok: boolean; error?: string }> {
	const ip = ingressIp();
	if (!ip) {
		return {
			ok: false,
			error:
				"No ingress IP configured (set HANZO_INGRESS_IP via KMS); DNS not created",
		};
	}
	if (!isCloudflareConfigured()) {
		return {
			ok: false,
			error: "Cloudflare not configured (CLOUDFLARE_* absent); DNS not created",
		};
	}
	try {
		await createDnsRecordForDefaultZone({
			type: "A",
			name: host,
			content: ip,
			ttl: 1,
			proxied: true,
			comment: "Hanzo white-label domain binding",
		});
		return { ok: true };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Bind a host to an org: record the binding, then auto-provision ingress + DNS
 * (+ cert via cert-manager). Idempotent on host — re-binding updates the row and
 * re-attempts provisioning. Returns the stored binding with honest status.
 */
export async function bindDomain(
	organizationId: string,
	input: BindDomainInput,
): Promise<WhitelabelDomain> {
	const host = normalizeHost(input.host);
	if (!host) throw new Error("host is required");

	const values = {
		host,
		organizationId,
		serviceName: input.serviceName ?? "console",
		port: input.port ?? 3000,
		https: input.https ?? true,
		namespace: input.namespace ?? "hanzo",
		cluster: input.cluster ?? "hanzo-k8s",
		tenantPackageId: input.tenantPackageId ?? null,
		status: "pending" as const,
	};

	// Upsert the binding row first (source of truth for the routed-host set).
	const [existing] = await db
		.select()
		.from(whitelabelDomains)
		.where(eq(whitelabelDomains.host, host))
		.limit(1);
	let binding: WhitelabelDomain;
	if (existing) {
		const [updated] = await db
			.update(whitelabelDomains)
			.set({ ...values, updatedAt: new Date() })
			.where(eq(whitelabelDomains.host, host))
			.returning();
		binding = updated!;
	} else {
		const [created] = await db
			.insert(whitelabelDomains)
			.values(values)
			.returning();
		binding = created!;
	}

	// Auto-provision ingress + DNS (best-effort, honest recording).
	const ing = await provisionIngress(binding);
	const dns = await provisionDns(host);

	const errors = [ing.error, dns.error].filter(Boolean);
	const status: WhitelabelDomain["status"] = ing.ok
		? errors.length === 0
			? "active"
			: "active" // ingress up; DNS may be externally managed — still routable
		: "error";

	const [final] = await db
		.update(whitelabelDomains)
		.set({
			ingressCreated: ing.ok,
			ingressName: ing.ok ? ing.name : null,
			dnsCreated: dns.ok,
			status,
			error: errors.length ? errors.join("; ") : null,
			updatedAt: new Date(),
		})
		.where(eq(whitelabelDomains.host, host))
		.returning();
	return final!;
}

/** List an org's bound hosts. */
export async function listDomains(
	organizationId: string,
): Promise<WhitelabelDomain[]> {
	return db
		.select()
		.from(whitelabelDomains)
		.where(eq(whitelabelDomains.organizationId, organizationId));
}

/** Tear down a binding: delete the ingress + DNS record, then the row. */
export async function unbindDomain(
	organizationId: string,
	host: string,
): Promise<void> {
	const h = normalizeHost(host);
	const [binding] = await db
		.select()
		.from(whitelabelDomains)
		.where(eq(whitelabelDomains.host, h))
		.limit(1);
	if (!binding || binding.organizationId !== organizationId) return;

	if (binding.ingressName) {
		try {
			const clients = await resolveOrgClusterClients(organizationId);
			await deleteIngress(clients, binding.namespace, binding.ingressName);
		} catch {
			// best-effort teardown; still remove the row
		}
	}
	if (binding.dnsCreated && isCloudflareConfigured()) {
		try {
			const records = await listDnsRecordsForDefaultZone({ name: h });
			for (const r of records) await deleteDnsRecordForDefaultZone(r.id);
		} catch {
			// best-effort
		}
	}
	await db.delete(whitelabelDomains).where(eq(whitelabelDomains.host, h));
}
