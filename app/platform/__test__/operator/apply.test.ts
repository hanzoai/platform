/**
 * Unit tests for the operator apply primitives (services/k8s/operator) — the two
 * apply SEMANTICS matched to two ownership models:
 *
 *   - `applyServiceCR` → SERVER-SIDE APPLY. A Service CR is SHARED with the
 *     operator (which patches /status and may add finalizers/annotations), so
 *     platform must field-managed-apply, never blind-replace. This is the exact
 *     semantic the retired gitops-reconcile cron used
 *     (`kubectl apply --server-side --force-conflicts --field-manager`).
 *   - `applyDatastoreCR` → REPLACE→create. A datastore CR is platform-EXCLUSIVE
 *     (user-driven, one writer), so a full replace is correct.
 *
 * The k8s client factory is mocked so the applies run against a recording fake
 * custom-objects client (no kubeconfig). The fake simulates SSA's key property —
 * fields present in the cluster object but NOT in the apply body survive — so we
 * can prove an operator-owned finalizer/annotation is preserved through an apply
 * (and would be dropped by a replace).
 */
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
	interface PatchCall {
		param: {
			group: string;
			version: string;
			namespace: string;
			plural: string;
			name: string;
			body: unknown;
			fieldManager?: string;
			force?: boolean;
		};
		options: unknown;
	}
	const calls = {
		patch: [] as PatchCall[],
		replace: [] as unknown[],
		create: [] as unknown[],
	};
	const store: Record<string, Record<string, unknown>> = {};
	return { calls, store };
});

vi.mock("@hanzo/platform/services/k8s/k8s-client", () => {
	// Minimal simulation of server-side apply's merge: the incoming (git) fields
	// win, but cluster-only keys (operator finalizers, operator annotations) are
	// preserved — the property that distinguishes an apply from a replace.
	const ssaMerge = (existing: any, incoming: any): any => {
		if (existing == null) return incoming;
		if (
			incoming == null ||
			Array.isArray(incoming) ||
			typeof incoming !== "object"
		) {
			return incoming;
		}
		const out = { ...existing };
		for (const k of Object.keys(incoming))
			out[k] = ssaMerge(existing[k], incoming[k]);
		return out;
	};

	const custom = {
		patchNamespacedCustomObject: async (param: any, options: unknown) => {
			h.calls.patch.push({ param, options });
			h.store[param.name] = ssaMerge(h.store[param.name], param.body);
			return h.store[param.name];
		},
		replaceNamespacedCustomObject: async (param: any) => {
			h.calls.replace.push(param);
			h.store[param.name] = param.body; // full overwrite (drops non-git fields)
			return param.body;
		},
		createNamespacedCustomObject: async (param: any) => {
			h.calls.create.push(param);
			return param.body;
		},
	};
	const clients = { custom };
	return {
		getDefaultClients: () => clients,
		createK8sClients: () => clients,
	};
});

import {
	applyDeclaredCRs,
	type DeclaredCRsSource,
} from "@hanzo/platform/services/apps/apply-declared";
import {
	applyDatastoreCR,
	applyServiceCR,
	type CustomResource,
	type DatastoreSpec,
	type OperatorServiceSpec,
} from "@hanzo/platform/services/k8s/operator";

/** Run each middleware's `pre` against a recording request; return set headers. */
function headersFrom(options: unknown): Record<string, string> {
	const headers: Record<string, string> = {};
	const req = {
		setHeaderParam: (k: string, v: string) => {
			headers[k] = v;
		},
	};
	const mw =
		(options as { middleware?: Array<{ pre: (r: unknown) => unknown }> })
			.middleware ?? [];
	for (const m of mw) m.pre(req);
	return headers;
}

const serviceCR = (
	name: string,
	extraMeta: Record<string, unknown> = {},
): CustomResource<OperatorServiceSpec> =>
	({
		apiVersion: "hanzo.ai/v1",
		kind: "Service",
		metadata: {
			name,
			namespace: "hanzo",
			labels: {},
			annotations: {},
			...extraMeta,
		},
		spec: { image: { repository: `ghcr.io/hanzoai/${name}`, tag: "1.0.0" } },
	}) as CustomResource<OperatorServiceSpec>;

describe("applyServiceCR — server-side apply", () => {
	it("issues a field-managed apply (patch), NOT a replace", async () => {
		h.calls.patch.length = 0;
		h.calls.replace.length = 0;
		for (const k of Object.keys(h.store)) delete h.store[k];

		await applyServiceCR(serviceCR("gallery-site"));

		expect(h.calls.replace).toHaveLength(0); // never a blind replace
		expect(h.calls.patch).toHaveLength(1);
		const { param, options } = h.calls.patch[0]!;
		expect(param.group).toBe("hanzo.ai");
		expect(param.version).toBe("v1");
		expect(param.plural).toBe("services");
		expect(param.name).toBe("gallery-site");
		expect(param.namespace).toBe("hanzo");
		expect(param.fieldManager).toBe("hanzo-platform");
		expect(param.force).toBe(true);
		// The apply media type — without it the server does a merge patch, not SSA.
		expect(headersFrom(options)["Content-Type"]).toBe(
			"application/apply-patch+yaml",
		);
	});

	it("preserves an operator-owned finalizer + annotation through the apply", async () => {
		for (const k of Object.keys(h.store)) delete h.store[k];
		// The cluster object as the operator left it: a finalizer + an operator
		// annotation that git does NOT declare.
		h.store.vector = {
			apiVersion: "hanzo.ai/v1",
			kind: "Service",
			metadata: {
				name: "vector",
				namespace: "hanzo",
				finalizers: ["hanzo.ai/operator"],
				annotations: { "hanzo.ai/operator-owned": "true" },
			},
			spec: { image: { repository: "ghcr.io/hanzoai/vector", tag: "0.9.0" } },
		};

		// Git declares a new tag but knows nothing of the operator's fields.
		await applyServiceCR(
			serviceCR("vector", { annotations: { "hanzo.ai/org": "hanzo" } }),
		);

		const merged = h.store.vector as {
			metadata: { finalizers?: string[]; annotations?: Record<string, string> };
			spec: { image: { tag: string } };
		};
		// Operator-owned fields survive…
		expect(merged.metadata.finalizers).toEqual(["hanzo.ai/operator"]);
		expect(merged.metadata.annotations?.["hanzo.ai/operator-owned"]).toBe(
			"true",
		);
		// …while git's declared fields are applied.
		expect(merged.metadata.annotations?.["hanzo.ai/org"]).toBe("hanzo");
		expect(merged.spec.image.tag).toBe("1.0.0");
	});
});

describe("applyDeclaredCRs — the declared-apply path issues SSA end-to-end", () => {
	it("pushes a reconcilable Service CR to the cluster via server-side apply", async () => {
		h.calls.patch.length = 0;
		h.calls.replace.length = 0;

		// Real applyServiceCR wired as the source's apply; fake list/read (no GitHub).
		const source: DeclaredCRsSource = {
			list: async () => [
				{ name: "vector.yaml", path: "crs/vector.yaml", sha: "a" },
			],
			read: async () =>
				`apiVersion: hanzo.ai/v1
kind: Service
metadata:
  name: vector
  namespace: hanzo
spec:
  image:
    repository: ghcr.io/hanzoai/vector
    tag: "1.0.0"
`,
			apply: applyServiceCR, // the real SSA primitive, hitting the mocked client
		};

		const summary = await applyDeclaredCRs(source, new Map());

		expect(summary.applied).toEqual(["vector"]);
		expect(h.calls.replace).toHaveLength(0);
		expect(h.calls.patch).toHaveLength(1);
		expect(h.calls.patch[0]!.param.fieldManager).toBe("hanzo-platform");
		expect(h.calls.patch[0]!.param.force).toBe(true);
		expect(headersFrom(h.calls.patch[0]!.options)["Content-Type"]).toBe(
			"application/apply-patch+yaml",
		);
	});
});

describe("applyDatastoreCR — replace (platform-exclusive, unchanged)", () => {
	it("issues a full replace, NOT a server-side apply", async () => {
		h.calls.patch.length = 0;
		h.calls.replace.length = 0;

		const cr = {
			apiVersion: "hanzo.ai/v1",
			kind: "SQL",
			metadata: { name: "pg", namespace: "hanzo", labels: {}, annotations: {} },
			spec: { type: "postgresql", storage: { size: "10Gi" } },
		} as CustomResource<DatastoreSpec>;

		await applyDatastoreCR(cr);

		expect(h.calls.patch).toHaveLength(0); // datastores are not SSA'd
		expect(h.calls.replace).toHaveLength(1);
	});
});
