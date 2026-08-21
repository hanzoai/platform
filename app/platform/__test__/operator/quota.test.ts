/**
 * Tests for quota enforcement that gates operator CR creation.
 * Quota is checked twice (platform pre-flight + operator admission webhook)
 * so the math has to agree byte-for-byte across both sides.
 */

import {
	checkQuota,
	defaultQuotaForTier,
	PLAN_LIMITS,
	parseCpuToMillicores,
	parseMemoryToMiB,
	parseStorageToGiB,
	QuotaError,
} from "@hanzo/platform/services/k8s/operator/quota";
import { describe, expect, it } from "vitest";

const ZERO_USAGE = {
	cpuMillicores: 0,
	memoryMiB: 0,
	storageGiB: 0,
	databaseCount: 0,
};

describe("quota parsers", () => {
	it("parses CPU", () => {
		expect(parseCpuToMillicores("2")).toBe(2000);
		expect(parseCpuToMillicores("500m")).toBe(500);
		expect(parseCpuToMillicores("0.5")).toBe(500);
		expect(parseCpuToMillicores("4")).toBe(4000);
	});
	it("rejects bad CPU", () => {
		expect(() => parseCpuToMillicores("abc")).toThrow(QuotaError);
	});
	it("parses memory", () => {
		expect(parseMemoryToMiB("4Gi")).toBe(4096);
		expect(parseMemoryToMiB("512Mi")).toBe(512);
		expect(parseMemoryToMiB("1024Ki")).toBe(1);
	});
	it("parses storage", () => {
		expect(parseStorageToGiB("100Gi")).toBe(100);
		expect(parseStorageToGiB("100")).toBe(100); // default Gi
		expect(parseStorageToGiB("1Ti")).toBe(1024);
	});
});

describe("checkQuota", () => {
	it("allows free-tier baseline request", () => {
		const result = checkQuota(
			"free",
			{ cpu: "250m", memory: "512Mi", storage: "5Gi" },
			ZERO_USAGE,
			true,
		);
		expect(result.allowed).toBe(true);
	});

	it("rejects per-CR cpu over plan limit", () => {
		expect(() =>
			checkQuota(
				"free",
				{ cpu: "1", memory: "256Mi", storage: "1Gi" },
				ZERO_USAGE,
				true,
			),
		).toThrow(QuotaError);
	});

	it("rejects per-CR storage over plan limit", () => {
		expect(() =>
			checkQuota(
				"starter",
				{ cpu: "1", memory: "1Gi", storage: "100Gi" },
				ZERO_USAGE,
				true,
			),
		).toThrow(/exceeds per-resource limit/);
	});

	it("rejects when org aggregate would overflow", () => {
		const limits = PLAN_LIMITS.starter;
		const usage = {
			cpuMillicores: limits.orgCpuMillicores - 500,
			memoryMiB: 0,
			storageGiB: 0,
			databaseCount: 0,
		};
		expect(() =>
			checkQuota(
				"starter",
				{ cpu: "1", memory: "1Gi", storage: "1Gi" },
				usage,
				true,
			),
		).toThrow(/org CPU usage/);
	});

	it("rejects when adding a new DB pushes count over the cap", () => {
		const usage = {
			cpuMillicores: 0,
			memoryMiB: 0,
			storageGiB: 0,
			databaseCount: 1,
		};
		expect(() =>
			checkQuota(
				"free",
				{ cpu: "100m", memory: "256Mi", storage: "1Gi" },
				usage,
				true,
			),
		).toThrow(/database count/);
	});

	it("allows usage check with addsNewDatabase=false (e.g. resize existing)", () => {
		const usage = {
			cpuMillicores: 0,
			memoryMiB: 0,
			storageGiB: 0,
			databaseCount: 1,
		};
		expect(
			checkQuota(
				"free",
				{ cpu: "100m", memory: "256Mi", storage: "1Gi" },
				usage,
				false,
			).allowed,
		).toBe(true);
	});
});

describe("defaultQuotaForTier", () => {
	it("returns plan-tier appropriate defaults that pass its own checkQuota", () => {
		for (const tier of ["free", "starter", "pro", "enterprise"] as const) {
			const quota = defaultQuotaForTier(tier);
			expect(checkQuota(tier, quota, ZERO_USAGE, true).allowed).toBe(true);
		}
	});
});
