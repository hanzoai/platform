/**
 * DeployExecutor — the native deploy leg that replaces GitHub Actions.
 *
 * These tests assert the WIRE EFFECT, not merely "no error thrown": which CRD
 * plural, which namespace, and the exact patch body. A deploy that reports
 * success while patching a resource nothing runs on is the failure mode this
 * suite exists to catch.
 *
 * No cluster is contacted: `resolveOrgClusterClients` is stubbed with a fake
 * CustomObjectsApi that records calls.
 */
import type { BuildJob } from "@hanzo/platform/db/schema";
import { executeDeploy } from "@hanzo/platform/services/ci/deploy-executor";
import type { DeployConfig } from "@hanzo/platform/services/ci/platform-config";
import { tenantNamespace } from "@hanzo/platform/services/k8s/operator/namespace-authz";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- fake cluster -----------------------------------------------------------

interface RecordedCall {
	group: string;
	version: string;
	namespace: string;
	plural: string;
	name?: string;
	body?: unknown;
}

const calls = vi.hoisted(() => ({
	patch: [] as RecordedCall[],
	create: [] as RecordedCall[],
	/** When set, the next patch rejects with this (used for the 404 create path). */
	patchError: null as unknown,
}));

const jobUpdates = vi.hoisted(() => [] as Record<string, unknown>[]);

// Production-shaped principals. `organization.id` is a nanoid, NOT a brand name
// (the live fleet org is `Yb5GFGDBEwcLsv2O8qWjS`, slug `hanzo`) — testing with
// readable ids would let a brand-keyed authorization bug pass green.
const { FLEET_ORG, LUX_ORG, TENANT_ORG } = vi.hoisted(() => ({
	FLEET_ORG: "Yb5GFGDBEwcLsv2O8qWjS",
	LUX_ORG: "Lx7QpZm2NvKd8RtYeWc1A",
	TENANT_ORG: "Mx3KpQr9TvBn2WsLdYe5F",
}));
/** What `tenantNamespace(TENANT_ORG)` produces — the tenant basis. */
const TENANT_NS = "tenant-mx3kpqr9tvbn2wsldye5f";

vi.mock("@hanzo/platform/services/dedicated-cluster", () => ({
	resolveOrgClusterClients: vi.fn(async () => ({
		custom: {
			patchNamespacedCustomObject: vi.fn(async (params: RecordedCall) => {
				calls.patch.push(params);
				if (calls.patchError) throw calls.patchError;
				return {};
			}),
			createNamespacedCustomObject: vi.fn(async (params: RecordedCall) => {
				calls.create.push(params);
				return {};
			}),
		},
	})),
}));

vi.mock("@hanzo/platform/services/ci/build-job", () => ({
	updateBuildJob: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
		jobUpdates.push(patch);
		return {};
	}),
}));

// The PaaS ticket signer needs a shared secret from the environment, which the
// vitest config freezes. Only the CREATE path mints one; stub just that export
// and keep the REAL authorizeNamespace / buildWorkloadCR / KIND_TO_PLURAL —
// those are exactly what these tests are here to exercise.
vi.mock("@hanzo/platform/services/k8s/operator", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	signPaasTicket: vi.fn(() => "test.ticket.sig"),
}));

// Configure fleet ownership the way production does — through the env var the
// REAL fleetNamespaceOwners() reads.
//
// Mocking the `fleetNamespaceOwners` export off the operator barrel does NOT
// work here: the module under test resolves that barrel by relative path from
// dist ("../k8s/operator/index.js") while the mock names it by package
// specifier, and through the pnpm workspace symlink those are two module
// identities. The mock is installed on one and the code calls the other, so the
// table silently stays empty and every deploy is refused with "no fleet
// namespaces are configured" — a failure that looks like broken authz but is
// broken test wiring.
//
// Driving the env var sidesteps module identity entirely and exercises the same
// path production takes.
beforeEach(() => {
	vi.stubEnv(
		"PLATFORM_FLEET_NAMESPACE_OWNERS",
		`hanzo=${FLEET_ORG},hanzo-testnet=${FLEET_ORG},hanzo-devnet=${FLEET_ORG},lux=${LUX_ORG}`,
	);
	// Same story for the PaaS ticket signer, which only the CREATE path mints:
	// it reads OPERATOR_PAAS_SHARED_SECRET directly, so stubbing the export off
	// the barrel never reaches it. A test-only value — in production this comes
	// from KMS.
	// >=32 bytes: the signer rejects anything shorter outright.
	vi.stubEnv(
		"OPERATOR_PAAS_SHARED_SECRET",
		"test-shared-secret-at-least-32-bytes-long",
	);
});
afterEach(() => {
	vi.unstubAllEnvs();
});

// --- fixtures ---------------------------------------------------------------

const job = (over: Partial<BuildJob> = {}): BuildJob =>
	({
		buildJobId: "bj_1",
		organizationId: FLEET_ORG,
		status: "succeeded",
		branch: "main",
		image: "ghcr.io/hanzoai/cloud:v1.801.215",
		...over,
	}) as BuildJob;

const deploy = (
	over: Partial<DeployConfig["target"]> = {},
	on = ["main"],
): DeployConfig => ({
	on,
	target: {
		cluster: "hanzo-k8s",
		namespace: "hanzo",
		operator: "hanzo-operator",
		crd: "App",
		name: "cloud",
		...over,
	},
});

beforeEach(() => {
	calls.patch.length = 0;
	calls.create.length = 0;
	calls.patchError = null;
	jobUpdates.length = 0;
});

/** The one refusal invariant: nothing reached the cluster. */
function expectNothingWritten() {
	expect(calls.patch).toHaveLength(0);
	expect(calls.create).toHaveLength(0);
}

// --- App: the canonical kind ------------------------------------------------

describe("App CR deploy", () => {
	it("patches spec.image on the apps CRD in the fleet namespace", async () => {
		const res = await executeDeploy(job(), deploy());

		expect(calls.patch).toHaveLength(1);
		const call = calls.patch[0]!;
		expect(call.group).toBe("hanzo.ai");
		expect(call.version).toBe("v1");
		// `apps`, NOT `services` — the fleet runs 82 apps.hanzo.ai CRs.
		expect(call.plural).toBe("apps");
		expect(call.namespace).toBe("hanzo");
		expect(call.name).toBe("cloud");

		// The exact body the operator reads (crd.rs ImageSpec: repository/tag).
		expect(call.body).toEqual({
			spec: {
				image: { repository: "ghcr.io/hanzoai/cloud", tag: "v1.801.215" },
			},
		});

		expect(res.rolledOut).toBe(true);
		expect(res.target).toBe("hanzo/cloud");
	});

	it("does not rewrite pullPolicy while rolling an image", async () => {
		await executeDeploy(job(), deploy());
		const image = (calls.patch[0]!.body as { spec: { image: object } }).spec
			.image;
		expect(image).not.toHaveProperty("pullPolicy");
	});

	it("deploys into the org's tenant namespace too", async () => {
		await executeDeploy(
			job({ organizationId: TENANT_ORG }),
			deploy({ namespace: TENANT_NS, name: "ai-demo" }),
		);
		expect(calls.patch[0]!.namespace).toBe(TENANT_NS);
		expect(calls.patch[0]!.plural).toBe("apps");
	});

	it("creates an App CR in a tenant namespace when none exists yet", async () => {
		calls.patchError = {
			code: 404,
			message: 'apps.hanzo.ai "cloud" not found',
		};

		const res = await executeDeploy(
			job({ organizationId: TENANT_ORG }),
			deploy({ namespace: TENANT_NS }),
		);

		expect(calls.create).toHaveLength(1);
		const created = calls.create[0]!;
		expect(created.plural).toBe("apps");
		const cr = created.body as {
			kind: string;
			apiVersion: string;
			spec: { image: { repository: string; tag: string } };
		};
		expect(cr.kind).toBe("App");
		expect(cr.apiVersion).toBe("hanzo.ai/v1");
		expect(cr.spec.image.repository).toBe("ghcr.io/hanzoai/cloud");
		expect(cr.spec.image.tag).toBe("v1.801.215");
		expect(res.rolledOut).toBe(true);
	});
});

// --- Service: the v0.3.0 alias, must not regress ----------------------------

describe("Service CR deploy (no regression)", () => {
	it("still patches the services CRD", async () => {
		await executeDeploy(
			job({ image: "python:3.12-alpine" }),
			deploy({ crd: "Service", name: "alert-sink" }),
		);

		const call = calls.patch[0]!;
		expect(call.plural).toBe("services");
		expect(call.name).toBe("alert-sink");
		expect(call.body).toEqual({
			spec: { image: { repository: "python", tag: "3.12-alpine" } },
		});
	});

	it("creates a Service CR with kind Service", async () => {
		calls.patchError = { code: 404, message: "not found" };
		await executeDeploy(
			job({ organizationId: TENANT_ORG }),
			deploy({ crd: "Service", namespace: TENANT_NS }),
		);
		expect((calls.create[0]!.body as { kind: string }).kind).toBe("Service");
		expect(calls.create[0]!.plural).toBe("services");
	});
});

// --- fleet namespaces are never auto-populated ------------------------------

describe("no auto-create in a fleet namespace", () => {
	it("refuses rather than creating a duplicate CR, and names the likely fix", async () => {
		// The live trap: several repos declare `crd: Service` while the fleet runs
		// `App`. Creating the missing Service CR would stand up a second
		// controller fighting the App over the same Deployment.
		calls.patchError = {
			code: 404,
			message: 'services.hanzo.ai "pricing" not found',
		};

		await expect(
			executeDeploy(job(), deploy({ crd: "Service", name: "pricing" })),
		).rejects.toThrow(/set deploy\.target\.crd: App/);

		expect(calls.create).toHaveLength(0);
	});

	it("still creates in a tenant namespace (zero-manual-CR onboarding)", async () => {
		calls.patchError = { code: 404, message: "not found" };
		await executeDeploy(
			job({ organizationId: TENANT_ORG }),
			deploy({ namespace: TENANT_NS }),
		);
		expect(calls.create).toHaveLength(1);
	});
});

// --- the security property --------------------------------------------------

describe("🔴 cross-tenant deploy is refused", () => {
	it("REFUSES a tenant org targeting the production fleet namespace", async () => {
		await expect(
			executeDeploy(job({ organizationId: TENANT_ORG }), deploy()),
		).rejects.toThrow(/belongs to another organization/);
		expectNothingWritten();
	});

	it("REFUSES a tenant org targeting another tenant's namespace", async () => {
		await expect(
			executeDeploy(
				job({ organizationId: TENANT_ORG }),
				deploy({ namespace: tenantNamespace(FLEET_ORG) }),
			),
		).rejects.toThrow(/tenant namespace/);
		expectNothingWritten();
	});

	it("REFUSES a fleet org reaching into another org's fleet", async () => {
		await expect(
			executeDeploy(
				job({ organizationId: FLEET_ORG }),
				deploy({ namespace: "lux" }),
			),
		).rejects.toThrow(/belongs to another organization/);
		expectNothingWritten();
	});

	it("REFUSES a prototype-key namespace as FORBIDDEN, not a 500", async () => {
		await expect(
			executeDeploy(job(), deploy({ namespace: "constructor" })),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expectNothingWritten();
		expect(jobUpdates).toContainEqual(
			expect.objectContaining({ rolloutStatus: "failed" }),
		);
	});

	it("REFUSES an unowned namespace (fail closed)", async () => {
		await expect(
			executeDeploy(job(), deploy({ namespace: "kube-system" })),
		).rejects.toThrow(/is neither this org's tenant namespace/);
		expectNothingWritten();
	});

	it("records the refusal on the build job as a failed rollout", async () => {
		await expect(
			executeDeploy(job({ organizationId: TENANT_ORG }), deploy()),
		).rejects.toThrow();
		expect(jobUpdates).toContainEqual(
			expect.objectContaining({ rolloutStatus: "failed" }),
		);
		// It must fail BEFORE marking the rollout pending — no half-state.
		expect(jobUpdates).not.toContainEqual(
			expect.objectContaining({ rolloutStatus: "pending" }),
		);
	});
});

// --- loud failures ----------------------------------------------------------

describe("unknown kind fails loudly", () => {
	it("refuses a CRD kind that is not a workload kind", async () => {
		await expect(
			executeDeploy(job(), deploy({ crd: "Widget" })),
		).rejects.toThrow(/Unsupported operator CRD kind "Widget"/);
		expectNothingWritten();
	});

	it("refuses a datastore kind — it carries no rollable image", async () => {
		await expect(executeDeploy(job(), deploy({ crd: "SQL" }))).rejects.toThrow(
			/Unsupported operator CRD kind "SQL"/,
		);
		expectNothingWritten();
	});
});

describe("non-deploy builds are skipped, not written", () => {
	it("skips when there is no deploy block", async () => {
		const res = await executeDeploy(job(), undefined);
		expect(res.rolledOut).toBe(false);
		expectNothingWritten();
	});

	it("skips when the branch is not a deploy branch", async () => {
		const res = await executeDeploy(job({ branch: "feature/x" }), deploy());
		expect(res.rolledOut).toBe(false);
		expectNothingWritten();
	});
});
