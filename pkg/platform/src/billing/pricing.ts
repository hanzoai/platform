/**
 * Hanzo Platform Pricing Configuration
 * Usage-based pricing for compute resources with subscription plans
 */

// Resource pricing rates (Railway-style)
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
		perGB: 0.05,
	},
} as const;

// Monthly service fee (applied to total usage)
export const SERVICE_FEE = {
	rate: 0.01, // 1% service fee
	minimumFee: 0,
	appliesTo: ["compute", "ai", "storage", "egress"],
	byokRate: 0.01,
} as const;

// Subscription plans
export const PLANS = {
	hobby: {
		name: "Hobby",
		monthlyFee: 20,
		monthlyCredits: 20,
		limits: {
			maxRAMPerService: 8,
			maxCPUPerService: 8,
			maxStorage: 100,
			organizations: 1,
		},
	},
	pro: {
		name: "Pro",
		monthlyFee: 200,
		monthlyCredits: 200,
		limits: {
			maxRAMPerService: 32,
			maxCPUPerService: 32,
			maxStorage: 500,
			organizations: -1,
		},
	},
} as const;

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

export type PlanType = keyof typeof PLANS;
