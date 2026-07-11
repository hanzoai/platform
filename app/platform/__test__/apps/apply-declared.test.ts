/**
 * Unit tests for the declared-CR apply (services/apps/apply-declared) — the
 * platform-native git→CR reconcile that replaces the gitops-reconcile cron.
 *
 * Two load-bearing pieces:
 *   1. `isReconcilable` — the SAFETY gate. Only a `hanzo.ai/v1` `Service` that
 *      opts in (marker OR seed allowlist) is applied; everything else is skipped.
 *   2. `applyDeclaredCRs` — the pass: fetch → parse → filter → apply. Exercised
 *      against a fake `DeclaredCRsSource` (no GitHub, no cluster) to prove it
 *      applies the reconcilable set, skips non-members, tolerates a per-CR
 *      failure without aborting the rest, and skips unchanged files (sha cache)
 *      while retrying a previously-failed file.
 */

import {
	applyDeclaredCRs,
	type DeclaredCRsSource,
	isReconcilable,
	RECONCILE_LABEL,
	RECONCILE_PLATFORM,
	type UniverseFile,
} from "@hanzo/platform/services/apps/apply-declared";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// YAML fixtures — real CR text so the parse path is exercised end-to-end.
// ---------------------------------------------------------------------------

/** A `hanzo.ai/v1` Service CR, optionally carrying the reconcile marker. */
const svc = (name: string, marker?: string) =>
	`apiVersion: hanzo.ai/v1
kind: Service
metadata:
  name: ${name}
  namespace: hanzo${marker ? `\n  labels:\n    ${RECONCILE_LABEL}: ${marker}` : ""}
spec:
  image:
    repository: ghcr.io/hanzoai/${name}
    tag: "1.0.0"
`;

/** A non-Service operator CR (kind=SQL) — never reconcilable by this module. */
const sqlCR = `apiVersion: hanzo.ai/v1
kind: SQL
metadata:
  name: pg
  namespace: hanzo
spec:
  type: postgresql
`;

describe("isReconcilable", () => {
	it("applies a Service whose name is in the seed allowlist", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: { name: "functions" },
			}),
		).toBe(true);
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: { name: "gallery-site" },
			}),
		).toBe(true);
	});

	it("applies a Service bearing the reconcile marker even when NOT in the seed", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: {
					name: "experimental",
					labels: { [RECONCILE_LABEL]: RECONCILE_PLATFORM },
				},
			}),
		).toBe(true);
		// annotation carries the marker just as well as a label
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: {
					name: "experimental",
					annotations: { [RECONCILE_LABEL]: RECONCILE_PLATFORM },
				},
			}),
		).toBe(true);
	});

	it("skips a Service that is neither marked nor in the seed (no mass-apply)", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: { name: "iam" },
			}),
		).toBe(false);
	});

	it("skips a marker set to any non-platform value", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: {
					name: "experimental",
					labels: { [RECONCILE_LABEL]: "argocd" },
				},
			}),
		).toBe(false);
	});

	it("skips a non-Service kind and a wrong apiVersion", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "SQL",
				metadata: { name: "functions" },
			}),
		).toBe(false);
		expect(
			isReconcilable({
				apiVersion: "v1",
				kind: "Service",
				metadata: { name: "functions" },
			}),
		).toBe(false);
	});

	it("skips a CR with no name", () => {
		expect(
			isReconcilable({
				apiVersion: "hanzo.ai/v1",
				kind: "Service",
				metadata: {},
			}),
		).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// applyDeclaredCRs — against an injected fake source (no IO)
// ---------------------------------------------------------------------------

interface FakeFile {
	name: string;
	sha: string;
	yaml: string;
}

const CRS = "infra/k8s/operator/crs";

/**
 * Build a `DeclaredCRsSource` over in-memory files. `applyImpl` decides each
 * CR's fate (throw = failure). Records the order/identity of applied CRs.
 */
function fakeSource(
	files: FakeFile[],
	applyImpl: (name: string) => void | Promise<void> = () => {},
): { source: DeclaredCRsSource; applied: string[] } {
	const applied: string[] = [];
	const byPath = new Map(files.map((f) => [`${CRS}/${f.name}`, f.yaml]));
	const source: DeclaredCRsSource = {
		list: async () =>
			files.map(
				(f): UniverseFile => ({
					name: f.name,
					path: `${CRS}/${f.name}`,
					sha: f.sha,
				}),
			),
		read: async (path) => {
			const y = byPath.get(path);
			if (y === undefined) throw new Error(`missing ${path}`);
			return y;
		},
		apply: async (cr) => {
			const name = cr.metadata.name;
			await applyImpl(name);
			applied.push(name);
		},
	};
	return { source, applied };
}

describe("applyDeclaredCRs", () => {
	it("applies the reconcilable set (seed + marker) and skips non-members", async () => {
		const { source, applied } = fakeSource([
			{ name: "functions.yaml", sha: "a", yaml: svc("functions") }, // seed
			{ name: "gallery-site.yaml", sha: "b", yaml: svc("gallery-site") }, // seed
			{
				name: "experimental.yaml",
				sha: "c",
				yaml: svc("experimental", RECONCILE_PLATFORM),
			}, // marker
			{ name: "iam.yaml", sha: "d", yaml: svc("iam") }, // not a member — skipped
			{ name: "sql.yaml", sha: "e", yaml: sqlCR }, // not a Service — skipped
		]);

		const summary = await applyDeclaredCRs(source, new Map());

		expect(new Set(summary.applied)).toEqual(
			new Set(["functions", "gallery-site", "experimental"]),
		);
		expect(new Set(applied)).toEqual(
			new Set(["functions", "gallery-site", "experimental"]),
		);
		expect(summary.skipped).toBe(2); // iam + sql
		expect(summary.failed).toEqual([]);
		expect(summary.unchanged).toBe(false);
	});

	it("tolerates a per-CR failure without aborting the rest", async () => {
		const { source, applied } = fakeSource(
			[
				{ name: "functions.yaml", sha: "a", yaml: svc("functions") },
				{ name: "vector.yaml", sha: "b", yaml: svc("vector") }, // this one throws
				{ name: "visor.yaml", sha: "c", yaml: svc("visor") },
			],
			(name) => {
				if (name === "vector") throw new Error("boom");
			},
		);

		const summary = await applyDeclaredCRs(source, new Map());

		// functions + visor still applied; vector collected as a failure.
		expect(new Set(applied)).toEqual(new Set(["functions", "visor"]));
		expect(new Set(summary.applied)).toEqual(new Set(["functions", "visor"]));
		expect(summary.failed).toEqual([{ name: "vector", error: "boom" }]);
	});

	it("skips unchanged files on the next pass (sha cache), and reports unchanged", async () => {
		const cache = new Map<string, string>();
		const { source, applied } = fakeSource([
			{ name: "functions.yaml", sha: "a", yaml: svc("functions") },
			{ name: "vector.yaml", sha: "a", yaml: svc("vector") },
		]);

		const first = await applyDeclaredCRs(source, cache);
		expect(new Set(first.applied)).toEqual(new Set(["functions", "vector"]));
		expect(first.unchanged).toBe(false);

		// Second pass: identical shas → nothing re-applied, unchanged=true.
		const second = await applyDeclaredCRs(source, cache);
		expect(second.applied).toEqual([]);
		expect(second.unchanged).toBe(true);
		// apply() was invoked exactly twice total (only on the first pass).
		expect(applied).toEqual(["functions", "vector"]);
	});

	it("retries a file whose apply failed last pass (sha not cached on failure)", async () => {
		const cache = new Map<string, string>();
		let failNext = true;
		const { source } = fakeSource(
			[{ name: "vector.yaml", sha: "a", yaml: svc("vector") }],
			(name) => {
				if (name === "vector" && failNext) {
					failNext = false;
					throw new Error("transient");
				}
			},
		);

		const first = await applyDeclaredCRs(source, cache);
		expect(first.failed).toEqual([{ name: "vector", error: "transient" }]);

		// Same sha, but the failure means it was NOT cached — so it retries and
		// now succeeds (proves failures don't get silently stuck).
		const second = await applyDeclaredCRs(source, cache);
		expect(second.applied).toEqual(["vector"]);
		expect(second.failed).toEqual([]);
	});

	it("records a file read failure without aborting the pass, and does not cache it", async () => {
		const cache = new Map<string, string>();
		const source: DeclaredCRsSource = {
			list: async () => [
				{ name: "functions.yaml", path: `${CRS}/functions.yaml`, sha: "a" },
				{ name: "broken.yaml", path: `${CRS}/broken.yaml`, sha: "b" },
			],
			read: async (path) => {
				if (path.endsWith("broken.yaml")) throw new Error("404");
				return svc("functions");
			},
			apply: async () => {},
		};

		const summary = await applyDeclaredCRs(source, cache);
		expect(summary.applied).toEqual(["functions"]);
		expect(summary.failed).toEqual([{ name: "broken.yaml", error: "404" }]);
		// functions cached (applied ok); broken NOT cached (retry next pass).
		expect(cache.get(`${CRS}/functions.yaml`)).toBe("a");
		expect(cache.has(`${CRS}/broken.yaml`)).toBe(false);
	});
});
