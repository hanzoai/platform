/**
 * Quota gating for operator CR materialization.
 *
 * Each plan tier (free, starter, pro, enterprise) defines an upper bound
 * on per-CR resource requests and a per-org aggregate. Platform must
 * enforce these BEFORE signing a PaaS ticket; the operator's admission
 * webhook re-enforces them on receipt as a defense-in-depth measure.
 *
 * Why both sides enforce: platform can pre-empt with a clean UX error
 * before any K8s API call; operator MUST re-enforce because annotations
 * are mutable and a compromised platform pod could lie about quota.
 *
 * Storage units accepted: `Gi`, `Mi`. CPU units: bare cores (`"2"`),
 * millicores (`"500m"`). Memory units: `Gi`, `Mi`.
 */
import type { QuotaRequest } from "./tenant";

// ---------------------------------------------------------------------------
// Plan definitions
// ---------------------------------------------------------------------------

export type PlanTier = "free" | "starter" | "pro" | "enterprise";

export interface PlanLimits {
	/** Max millicores per single CR. */
	perCRCpuMillicores: number;
	/** Max memory MiB per single CR. */
	perCRMemoryMiB: number;
	/** Max storage GiB per single CR. */
	perCRStorageGiB: number;
	/** Max millicores per organization across all operator-managed CRs. */
	orgCpuMillicores: number;
	/** Max memory MiB per organization. */
	orgMemoryMiB: number;
	/** Max storage GiB per organization. */
	orgStorageGiB: number;
	/** Max count of operator-managed databases per organization. */
	orgMaxDatabases: number;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
	free: {
		perCRCpuMillicores: 500,
		perCRMemoryMiB: 1024,
		perCRStorageGiB: 5,
		orgCpuMillicores: 1000,
		orgMemoryMiB: 2048,
		orgStorageGiB: 10,
		orgMaxDatabases: 1,
	},
	starter: {
		perCRCpuMillicores: 2000,
		perCRMemoryMiB: 4096,
		perCRStorageGiB: 50,
		orgCpuMillicores: 4000,
		orgMemoryMiB: 8192,
		orgStorageGiB: 100,
		orgMaxDatabases: 5,
	},
	pro: {
		perCRCpuMillicores: 8000,
		perCRMemoryMiB: 32768,
		perCRStorageGiB: 500,
		orgCpuMillicores: 32000,
		orgMemoryMiB: 131072,
		orgStorageGiB: 2000,
		orgMaxDatabases: 50,
	},
	enterprise: {
		perCRCpuMillicores: 64000,
		perCRMemoryMiB: 524288,
		perCRStorageGiB: 10000,
		orgCpuMillicores: 256000,
		orgMemoryMiB: 1048576,
		orgStorageGiB: 100000,
		orgMaxDatabases: 1000,
	},
};

// ---------------------------------------------------------------------------
// Quantity parsing
// ---------------------------------------------------------------------------

export class QuotaError extends Error {
	constructor(public field: keyof QuotaRequest | "count", message: string) {
		super(message);
		this.name = "QuotaError";
	}
}

export function parseCpuToMillicores(value: string): number {
	if (value.endsWith("m")) {
		const n = Number.parseInt(value.slice(0, -1), 10);
		if (!Number.isFinite(n)) throw new QuotaError("cpu", `bad CPU quantity: ${value}`);
		return n;
	}
	const n = Number.parseFloat(value);
	if (!Number.isFinite(n)) throw new QuotaError("cpu", `bad CPU quantity: ${value}`);
	return Math.round(n * 1000);
}

export function parseMemoryToMiB(value: string): number {
	const m = value.match(/^(\d+)([KMGTP]i)?$/);
	if (!m || m[1] === undefined) throw new QuotaError("memory", `bad memory quantity: ${value}`);
	const n = Number.parseInt(m[1], 10);
	const unit = m[2] ?? "";
	switch (unit) {
		case "":
			return Math.round(n / (1024 * 1024));
		case "Ki":
			return Math.round(n / 1024);
		case "Mi":
			return n;
		case "Gi":
			return n * 1024;
		case "Ti":
			return n * 1024 * 1024;
		case "Pi":
			return n * 1024 * 1024 * 1024;
	}
	throw new QuotaError("memory", `bad memory quantity: ${value}`);
}

export function parseStorageToGiB(value: string): number {
	const m = value.match(/^(\d+)(Mi|Gi|Ti|Pi)?$/);
	if (!m || m[1] === undefined) throw new QuotaError("storage", `bad storage quantity: ${value}`);
	const n = Number.parseInt(m[1], 10);
	const unit = m[2] ?? "Gi";
	switch (unit) {
		case "Mi":
			return Math.max(1, Math.round(n / 1024));
		case "Gi":
			return n;
		case "Ti":
			return n * 1024;
		case "Pi":
			return n * 1024 * 1024;
	}
	throw new QuotaError("storage", `bad storage quantity: ${value}`);
}

// ---------------------------------------------------------------------------
// Quota check
// ---------------------------------------------------------------------------

export interface OrgUsage {
	/** Sum of CPU requests (millicores) across all operator-managed CRs in this org. */
	cpuMillicores: number;
	/** Sum of memory requests (MiB) across all operator-managed CRs in this org. */
	memoryMiB: number;
	/** Sum of storage requests (GiB) across all operator-managed CRs in this org. */
	storageGiB: number;
	/** Count of operator-managed databases in this org. */
	databaseCount: number;
}

export interface QuotaCheckResult {
	allowed: true;
}

/**
 * Verify the requested quota fits within the plan tier AND that adding
 * it to current org usage stays under the org caps.
 *
 * Throws QuotaError on the first violation. The error's `field` names
 * the offending dimension so the UI can highlight it.
 */
export function checkQuota(
	tier: PlanTier,
	request: QuotaRequest,
	currentUsage: OrgUsage,
	addsNewDatabase = true,
): QuotaCheckResult {
	const limits = PLAN_LIMITS[tier];

	const cpu = parseCpuToMillicores(request.cpu);
	const memory = parseMemoryToMiB(request.memory);
	const storage = parseStorageToGiB(request.storage);

	if (cpu > limits.perCRCpuMillicores)
		throw new QuotaError("cpu", `CPU request ${request.cpu} exceeds per-resource limit ${limits.perCRCpuMillicores}m for ${tier} plan`);
	if (memory > limits.perCRMemoryMiB)
		throw new QuotaError("memory", `memory request ${request.memory} exceeds per-resource limit ${limits.perCRMemoryMiB}Mi for ${tier} plan`);
	if (storage > limits.perCRStorageGiB)
		throw new QuotaError("storage", `storage request ${request.storage} exceeds per-resource limit ${limits.perCRStorageGiB}Gi for ${tier} plan`);

	if (currentUsage.cpuMillicores + cpu > limits.orgCpuMillicores)
		throw new QuotaError("cpu", `org CPU usage would exceed ${limits.orgCpuMillicores}m on ${tier} plan`);
	if (currentUsage.memoryMiB + memory > limits.orgMemoryMiB)
		throw new QuotaError("memory", `org memory usage would exceed ${limits.orgMemoryMiB}Mi on ${tier} plan`);
	if (currentUsage.storageGiB + storage > limits.orgStorageGiB)
		throw new QuotaError("storage", `org storage usage would exceed ${limits.orgStorageGiB}Gi on ${tier} plan`);
	if (addsNewDatabase && currentUsage.databaseCount + 1 > limits.orgMaxDatabases)
		throw new QuotaError("count", `org database count would exceed ${limits.orgMaxDatabases} on ${tier} plan`);

	return { allowed: true };
}

/**
 * Resolve a plan tier to a default per-CR quota envelope. Used when the
 * caller hasn't specified explicit resource requests (most UI flows).
 */
export function defaultQuotaForTier(tier: PlanTier): QuotaRequest {
	const limits = PLAN_LIMITS[tier];
	// Use 1/2 of per-CR ceiling as the default so multiple CRs fit per org.
	return {
		cpu: `${Math.max(100, Math.floor(limits.perCRCpuMillicores / 2))}m`,
		memory: `${Math.max(256, Math.floor(limits.perCRMemoryMiB / 2))}Mi`,
		storage: `${Math.max(1, Math.floor(limits.perCRStorageGiB / 2))}Gi`,
	};
}
