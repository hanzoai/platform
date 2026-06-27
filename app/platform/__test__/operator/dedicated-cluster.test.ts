/**
 * Tests for the dedicated-cluster control plane (launch a customer's own
 * "Hanzo K8S" cluster). Mirrors the operator CR-builder / tenant-ticket test
 * style: pin the PURE wire shapes (the baseline applied to a new cluster, the
 * lifecycle reducer, the ClusterTarget bridge) and the KMS secret gating that
 * guarantees we never touch a paid DO cluster without a KMS-sourced token.
 *
 * Field changes to buildClusterBaseline are breaking changes to what a freshly
 * provisioned cluster receives, so they are pinned here.
 */

import {
	attachExternalCluster,
	type BaselineObject,
	type BaselineSecret,
	type BaselineServiceCR,
	buildClusterBaseline,
	clusterKubeconfig,
	clusterTargetFromRecord,
	nextPhase,
	OPERATOR_MANIFEST_URL,
	OPERATOR_NAMESPACE,
	PAAS_TICKET_SECRET,
	provisionDedicatedCluster,
	redactCluster,
	redactTarget,
	resolveOrgClusterTarget,
} from "@hanzo/platform/services/dedicated-cluster";

import {
	KmsSecretMissingError,
	kmsSecret,
	requireKmsSecret,
} from "@hanzo/platform/services/kms";
import { sealSecret } from "@hanzo/platform/services/secret-box";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORG = "org-acme";
const SECRET = "x".repeat(32);

function baseline(): BaselineObject[] {
	return buildClusterBaseline({ organizationId: ORG, sharedSecret: SECRET });
}

describe("buildClusterBaseline", () => {
	const objs = baseline();
	const kinds = objs.map((o) => o.kind);

	it("emits the full baseline set in dependency order", () => {
		// Namespaces + operator bundle (registers CRDs) must precede the Service CRs.
		expect(kinds).toEqual([
			"Namespace",
			"Namespace",
			"OperatorBundle",
			"Secret",
			"ServiceCR",
			"ServiceCR",
		]);
	});

	it("creates the operator namespace and the tenant namespace", () => {
		const namespaces = objs
			.filter((o) => o.kind === "Namespace")
			.map((o) => (o as { name: string }).name);
		expect(namespaces).toContain(OPERATOR_NAMESPACE);
		expect(namespaces).toContain(`tenant-${ORG}`);
	});

	it("seeds the PaaS-ticket shared secret into the operator namespace", () => {
		const secret = objs.find((o) => o.kind === "Secret") as BaselineSecret;
		expect(secret.name).toBe(PAAS_TICKET_SECRET);
		expect(secret.namespace).toBe(OPERATOR_NAMESPACE);
		// The value is carried as stringData (k8s base64-encodes it), never logged.
		expect(secret.stringData.secret).toBe(SECRET);
	});

	it("defaults the operator bundle to the canonical hanzoai/operator manifest", () => {
		const bundle = objs.find((o) => o.kind === "OperatorBundle") as {
			manifestUrl: string;
		};
		expect(bundle.manifestUrl).toBe(OPERATOR_MANIFEST_URL);
	});

	it("honors an operator bundle URL override", () => {
		const custom = buildClusterBaseline({
			organizationId: ORG,
			sharedSecret: SECRET,
			operatorManifestUrl: "https://example/op.yaml",
		});
		const bundle = custom.find((o) => o.kind === "OperatorBundle") as {
			manifestUrl: string;
		};
		expect(bundle.manifestUrl).toBe("https://example/op.yaml");
	});

	it("declares ingress + gateway as operator Service CRs", () => {
		const services = objs.filter(
			(o) => o.kind === "ServiceCR",
		) as BaselineServiceCR[];
		const byName = Object.fromEntries(services.map((s) => [s.name, s]));

		expect(byName.ingress).toBeDefined();
		expect(byName.gateway).toBeDefined();

		const ingress = byName.ingress as BaselineServiceCR;
		expect((ingress.body as any).apiVersion).toBe("hanzo.ai/v1");
		expect((ingress.body as any).kind).toBe("Service");
		expect(ingress.namespace).toBe(OPERATOR_NAMESPACE);
		expect((ingress.body as any).spec.image.repository).toBe(
			"ghcr.io/hanzoai/ingress",
		);
		expect((ingress.body as any).spec.ports[0].containerPort).toBe(80);

		const gateway = byName.gateway as BaselineServiceCR;
		expect((gateway.body as any).spec.image.repository).toBe(
			"ghcr.io/hanzoai/gateway",
		);
		expect((gateway.body as any).spec.ports[0].containerPort).toBe(8080);
	});

	it("tags every baseline workload to the tenant", () => {
		const services = objs.filter(
			(o) => o.kind === "ServiceCR",
		) as BaselineServiceCR[];
		for (const s of services) {
			expect((s.body as any).metadata.labels["hanzo.ai/tenant"]).toBe(ORG);
		}
	});
});

describe("nextPhase (lifecycle reducer)", () => {
	it("walks the happy path requested → provisioning → installing → ready", () => {
		expect(nextPhase("requested", "provisionStarted")).toBe("provisioning");
		expect(nextPhase("provisioning", "doksRunning")).toBe("installing");
		expect(nextPhase("installing", "baselineDone")).toBe("ready");
	});

	it("sends any phase to error on failure", () => {
		for (const p of [
			"requested",
			"provisioning",
			"installing",
			"ready",
		] as const) {
			expect(nextPhase(p, "failed")).toBe("error");
		}
	});

	it("allows retry from error (re-provision and re-install)", () => {
		expect(nextPhase("error", "provisionStarted")).toBe("provisioning");
		expect(nextPhase("error", "baselineStarted")).toBe("installing");
	});

	it("re-installs the baseline from ready (idempotent reconcile)", () => {
		expect(nextPhase("ready", "baselineStarted")).toBe("installing");
	});

	it("starts the baseline from requested (BYO attach entry point)", () => {
		// An attached BYO cluster never passes through DO `provisioning`; its first
		// baseline install transitions requested → installing.
		expect(nextPhase("requested", "baselineStarted")).toBe("installing");
	});

	it("is total: illegal transitions leave the phase unchanged", () => {
		expect(nextPhase("ready", "doksRunning")).toBe("ready");
		expect(nextPhase("requested", "baselineDone")).toBe("requested");
		expect(nextPhase("requested", "doksRunning")).toBe("requested");
	});
});

describe("clusterTargetFromRecord (operator/inventory bridge)", () => {
	const record = { name: "hanzo-acme", organizationId: ORG };

	it("maps the dedicated cluster to a ClusterTarget with its tenant namespace", () => {
		const target = clusterTargetFromRecord(record, "KCFG");
		expect(target.cluster).toBe("hanzo-acme");
		expect(target.namespaces).toEqual({ [`tenant-${ORG}`]: "main" });
		expect(target.kubeconfig).toBe("KCFG");
	});

	it("honors a non-default env", () => {
		const target = clusterTargetFromRecord(record, "KCFG", "test");
		expect(target.namespaces).toEqual({ [`tenant-${ORG}`]: "test" });
	});
});

describe("redactTarget (never leak the kubeconfig)", () => {
	it("drops the kubeconfig and marks a dedicated target", () => {
		const view = redactTarget({
			cluster: "hanzo-acme",
			namespaces: { [`tenant-${ORG}`]: "main" },
			kubeconfig: "SECRET-KCFG",
		});
		expect(view).toEqual({
			cluster: "hanzo-acme",
			namespaces: { [`tenant-${ORG}`]: "main" },
			dedicated: true,
		});
		expect(JSON.stringify(view)).not.toContain("SECRET-KCFG");
	});

	it("marks the shared (no-kubeconfig) target as not dedicated", () => {
		const view = redactTarget({
			cluster: "hanzo-k8s",
			namespaces: { hanzo: "main" },
		});
		expect(view.dedicated).toBe(false);
	});
});

describe("redactCluster (never leak the sealed kubeconfig)", () => {
	it("drops kubeconfigEncrypted and keeps every other field", () => {
		const row = {
			doksClusterId: "c-1",
			name: "byo",
			organizationId: ORG,
			phase: "ready",
			active: true,
			kubeconfigEncrypted: "v1:secret:tag:ciphertext",
		};
		const safe = redactCluster(row);
		expect(safe).toEqual({
			doksClusterId: "c-1",
			name: "byo",
			organizationId: ORG,
			phase: "ready",
			active: true,
		});
		expect("kubeconfigEncrypted" in safe).toBe(false);
		expect(JSON.stringify(safe)).not.toContain("ciphertext");
	});

	it("strips the (null) ciphertext column from a managed cluster row", () => {
		// A managed DOKS row still carries the column, just null — redactCluster
		// removes the key entirely so the shape is uniform across managed + BYO.
		const row = {
			doksClusterId: "c-2",
			name: "managed",
			active: false,
			kubeconfigEncrypted: null,
		};
		const safe = redactCluster(row);
		expect(safe).toEqual({
			doksClusterId: "c-2",
			name: "managed",
			active: false,
		});
		expect("kubeconfigEncrypted" in safe).toBe(false);
	});
});

describe("clusterKubeconfig (BYO-aware resolver)", () => {
	let original: string | undefined;
	beforeEach(() => {
		original = process.env.PAAS_SECRET_KEY;
		process.env.PAAS_SECRET_KEY = "test-cluster-kubeconfig-key-0123456789";
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PAAS_SECRET_KEY;
		else process.env.PAAS_SECRET_KEY = original;
	});

	it("decrypts the sealed kubeconfig for an attached BYO cluster", async () => {
		const kubeconfig = "apiVersion: v1\nkind: Config\nclusters: []\n";
		const record = {
			doksClusterId: "byo-1",
			doClusterId: null,
			kubeconfigEncrypted: sealSecret(kubeconfig),
		};
		await expect(clusterKubeconfig(record)).resolves.toBe(kubeconfig);
	});
});

describe("resolveOrgClusterTarget (operator/inventory bridge)", () => {
	it("falls back to the shared cluster when the org has no active cluster", async () => {
		// The mocked db returns no active cluster (findFirst → undefined), so the
		// resolver must hand back the shared target (no kubeconfig → not dedicated).
		const target = await resolveOrgClusterTarget("org-without-dedicated");
		expect(redactTarget(target).dedicated).toBe(false);
		expect(target.kubeconfig).toBeUndefined();
	});
});

describe("attachExternalCluster (BYO attach)", () => {
	it("rejects when the organization does not exist", async () => {
		// The mocked db returns no organization (findFirst → undefined).
		await expect(
			attachExternalCluster({
				organizationId: "ghost-org",
				name: "byo",
				kubeconfig: "apiVersion: v1\nkind: Config\n",
			}),
		).rejects.toThrow(/Organization not found/);
	});
});

describe("KMS secret gating", () => {
	let original: string | undefined;

	beforeEach(() => {
		original = process.env.PAAS_DO_API_TOKEN;
		delete process.env.PAAS_DO_API_TOKEN;
	});

	afterEach(() => {
		if (original === undefined) delete process.env.PAAS_DO_API_TOKEN;
		else process.env.PAAS_DO_API_TOKEN = original;
	});

	it("requireKmsSecret throws a KMS-pathed error when unset", () => {
		expect(() => requireKmsSecret("PAAS_DO_API_TOKEN")).toThrow(
			KmsSecretMissingError,
		);
		expect(() => requireKmsSecret("PAAS_DO_API_TOKEN")).toThrow(/KMSSecret/);
	});

	it("kmsSecret returns undefined (not empty string) when unset", () => {
		expect(kmsSecret("PAAS_DO_API_TOKEN")).toBeUndefined();
	});

	it("requireKmsSecret returns the synced value when present", () => {
		process.env.PAAS_DO_API_TOKEN = "dop_v1_test";
		expect(requireKmsSecret("PAAS_DO_API_TOKEN")).toBe("dop_v1_test");
	});

	it("provisionDedicatedCluster refuses to create a cluster without the KMS DO token", async () => {
		// The DO token gate runs BEFORE any DigitalOcean call, so a missing
		// KMS-synced token can never result in a paid cluster being created.
		await expect(
			provisionDedicatedCluster({ organizationId: ORG }),
		).rejects.toThrow(KmsSecretMissingError);
	});
});
