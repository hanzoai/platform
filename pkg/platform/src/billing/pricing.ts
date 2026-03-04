/**
 * Hanzo Platform Pricing Configuration
 * Usage-based pricing for compute resources with subscription plans.
 *
 * Canonical plan definitions are served by pricing.hanzo.ai.
 * Static PLANS below are the fallback when the API is unreachable.
 */

// ---------------------------------------------------------------------------
// Plan types
// ---------------------------------------------------------------------------

/** Canonical plan identifiers. */
export type PlanType = "developer" | "pro" | "team" | "enterprise";

/** Legacy plan names that may still exist in the database. */
export type LegacyPlanType = "hobby";

/** All values that can appear in the `plan` text column. */
export type AnyPlanType = PlanType | LegacyPlanType;

/**
 * Normalize a plan identifier read from the database or subscription metadata.
 * Maps legacy names to their canonical equivalents.
 */
export function normalizePlanType(plan: string): PlanType {
  if (plan === "hobby") return "developer";
  if ((plan as PlanType) === "developer" || plan === "pro" || plan === "team" || plan === "enterprise") {
    return plan as PlanType;
  }
  // Unknown plan -- treat as developer (free tier) to avoid crashes.
  console.warn(`[pricing] Unknown plan type "${plan}", falling back to "developer"`);
  return "developer";
}

// ---------------------------------------------------------------------------
// Plan configuration
// ---------------------------------------------------------------------------

export interface PlanConfig {
  name: string;
  description?: string;
  monthlyFee: number;
  annualFee: number | null; // null = not available / contact sales
  monthlyCredits: number;
  features?: string[];
  limits: {
    maxRAMPerService: number;
    maxCPUPerService: number;
    maxStorage: number;
    organizations: number; // -1 = unlimited
  };
}

/**
 * Static fallback plans -- used when pricing.hanzo.ai is unreachable.
 * Values MUST match the canonical definitions at pricing.hanzo.ai.
 */
export const PLANS: Record<PlanType, PlanConfig> = {
  developer: {
    name: "Developer",
    monthlyFee: 0,
    annualFee: 0,
    monthlyCredits: 5,
    limits: {
      maxRAMPerService: 4,
      maxCPUPerService: 4,
      maxStorage: 50,
      organizations: 1,
    },
  },
  pro: {
    name: "Pro",
    monthlyFee: 49,
    annualFee: 39 * 12, // $39/mo billed annually
    monthlyCredits: 49,
    limits: {
      maxRAMPerService: 16,
      maxCPUPerService: 16,
      maxStorage: 250,
      organizations: 3,
    },
  },
  team: {
    name: "Team",
    monthlyFee: 199,
    annualFee: 159 * 12, // $159/mo billed annually
    monthlyCredits: 199,
    limits: {
      maxRAMPerService: 32,
      maxCPUPerService: 32,
      maxStorage: 500,
      organizations: -1,
    },
  },
  enterprise: {
    name: "Enterprise",
    monthlyFee: 0, // custom pricing
    annualFee: null,
    monthlyCredits: 0, // negotiated
    limits: {
      maxRAMPerService: -1,
      maxCPUPerService: -1,
      maxStorage: -1,
      organizations: -1,
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Remote plan fetch with TTL cache
// ---------------------------------------------------------------------------

const PRICING_API_URL =
  process.env.PRICING_API_URL || "https://pricing.hanzo.ai/v1/pricing/subscriptions";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let _cachedPlans: Record<PlanType, PlanConfig> | null = null;
let _cacheTimestamp = 0;

/**
 * Fetch plans from the pricing API, returning the cached result when fresh.
 * Falls back to static PLANS on network errors.
 */
export async function getPlans(): Promise<Record<PlanType, PlanConfig>> {
  const now = Date.now();
  if (_cachedPlans && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cachedPlans;
  }

  try {
    const res = await fetch(PRICING_API_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      throw new Error(`pricing API returned ${res.status}`);
    }

    const data = await res.json();

    // The API returns { plans: [...] } as an array of plan objects.
    const rawPlans = data.plans ?? data;
    let plans: Record<PlanType, PlanConfig>;

    if (Array.isArray(rawPlans)) {
      // Transform array into Record<PlanType, PlanConfig>
      plans = {} as Record<PlanType, PlanConfig>;
      for (const p of rawPlans) {
        const id = normalizePlanType(p.id ?? p.name?.toLowerCase() ?? "developer");
        plans[id] = {
          name: p.name ?? id,
          description: p.description ?? undefined,
          monthlyFee: p.priceMonthly ?? p.monthlyFee ?? 0,
          annualFee: p.priceAnnual != null ? p.priceAnnual * 12 : (p.annualFee ?? null),
          monthlyCredits: p.limits?.freeCredit ?? p.monthlyCredits ?? p.priceMonthly ?? 0,
          features: Array.isArray(p.features) ? p.features : undefined,
          limits: {
            maxRAMPerService: p.limits?.maxRAMPerService ?? PLANS[id]?.limits.maxRAMPerService ?? 4,
            maxCPUPerService: p.limits?.maxCPUPerService ?? PLANS[id]?.limits.maxCPUPerService ?? 4,
            maxStorage: p.limits?.maxStorage ?? PLANS[id]?.limits.maxStorage ?? 50,
            organizations: p.limits?.maxMembers ?? PLANS[id]?.limits.organizations ?? 1,
          },
        };
      }
    } else {
      plans = rawPlans as Record<PlanType, PlanConfig>;
    }

    // Validate we got at least developer and pro.
    if (!plans.developer || !plans.pro) {
      throw new Error("pricing API response missing required plans");
    }

    _cachedPlans = plans;
    _cacheTimestamp = now;
    return _cachedPlans;
  } catch (err) {
    console.warn("[pricing] Failed to fetch from pricing API, using static fallback:", (err as Error).message);
    return PLANS;
  }
}

/**
 * Look up a specific plan, normalizing legacy names.
 * Uses the cached remote plans when available.
 */
export async function getPlan(plan: string): Promise<PlanConfig> {
  const plans = await getPlans();
  const key = normalizePlanType(plan);
  return plans[key] ?? PLANS.developer;
}

// ---------------------------------------------------------------------------
// Resource pricing rates (infrastructure costs -- unchanged)
// ---------------------------------------------------------------------------

export const USAGE_RATES = {
  memory: {
    perGBPerSecond: 0.00000386,
    perGBPerHour: 0.013896,
    perGBPerMonth: 10,
  },
  cpu: {
    perVCPUPerSecond: 0.00000772,
    perVCPUPerHour: 0.027792,
    perVCPUPerMonth: 20,
  },
  storage: {
    perGBPerSecond: 0.00000006,
    perGBPerHour: 0.000216,
    perGBPerMonth: 0.15,
  },
  egress: {
    perGB: 0, // Zero egress fees — Hanzo policy
  },
} as const;

export const SERVICE_FEE = {
  rate: 0.01,
  minimumFee: 0,
  appliesTo: ["compute", "ai", "storage", "egress"],
  byokRate: 0.01,
} as const;

// ---------------------------------------------------------------------------
// Cost calculation helpers (unchanged)
// ---------------------------------------------------------------------------

export function calculateCPUCost(vCPUSeconds: number): number {
  return vCPUSeconds * USAGE_RATES.cpu.perVCPUPerSecond;
}

export function calculateMemoryCost(gbSeconds: number): number {
  return gbSeconds * USAGE_RATES.memory.perGBPerSecond;
}

export function calculateStorageCost(gbSeconds: number): number {
  return gbSeconds * USAGE_RATES.storage.perGBPerSecond;
}

export function calculateEgressCost(gb: number): number {
  return gb * USAGE_RATES.egress.perGB;
}

export function calculateTotalUsageCost(usage: {
  cpuSeconds: number;
  memoryGbSeconds: number;
  storageGbSeconds: number;
  egressGb: number;
}): {
  cpuCost: number;
  memoryCost: number;
  storageCost: number;
  egressCost: number;
  totalCost: number;
} {
  const cpuCost = calculateCPUCost(usage.cpuSeconds);
  const memoryCost = calculateMemoryCost(usage.memoryGbSeconds);
  const storageCost = calculateStorageCost(usage.storageGbSeconds);
  const egressCost = calculateEgressCost(usage.egressGb);

  return {
    cpuCost,
    memoryCost,
    storageCost,
    egressCost,
    totalCost: cpuCost + memoryCost + storageCost + egressCost,
  };
}

export function calculateServiceFee(totalUsage: number): number {
  return totalUsage * SERVICE_FEE.rate;
}
