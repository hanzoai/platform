/**
 * Unit tests for the live apps inventory mapping (services/apps/inventory).
 *
 * The pure mappers (CR + Deployment → ObservedApp) are the load-bearing
 * correctness of the apps board: org/env/repo derivation, running-tag selection
 * across sidecars, and health rollup. They import only `parseImageRef` (no DB),
 * so they run in the mocked unit pool with no cluster and no SQLite.
 *
 * `discoverApps` is exercised against a fake K8sClients to prove the two-list
 * join (CRs × Deployments by name) and that CRs without a Deployment still
 * yield a row (declared but not running).
 */
import { describe, expect, it } from "vitest";
import {
	brandOrg,
	declaredOrg,
	discoverApps,
	healthFromDeployment,
	observeService,
	orgForService,
	orgFromRepository,
	repoFromRepository,
	runningTagFromDeployment,
	type ClusterTarget,
} from "@hanzo/platform/services/apps/inventory";

describe("orgFromRepository", () => {
	it("extracts the namespace from a registry-qualified repo", () => {
		expect(orgFromRepository("ghcr.io/hanzoai/chat")).toBe("hanzoai");
		expect(orgFromRepository("ghcr.io/luxfi/node")).toBe("luxfi");
		expect(orgFromRepository("docker.io/grafana/grafana")).toBe("grafana");
	});
	it("handles a bare namespace/name (no registry host)", () => {
		expect(orgFromRepository("hanzoai/iam")).toBe("hanzoai");
	});
	it("falls back to the whole ref when there is no namespace", () => {
		expect(orgFromRepository("postgres")).toBe("postgres");
	});
});

describe("repoFromRepository", () => {
	it("strips the registry host to the owner/repo coordinate", () => {
		expect(repoFromRepository("ghcr.io/hanzoai/chat")).toBe("hanzoai/chat");
		expect(repoFromRepository("ghcr.io/hanzoai/insights/capture")).toBe(
			"hanzoai/insights/capture",
		);
	});
	it("keeps a bare namespace/name unchanged", () => {
		expect(repoFromRepository("hanzoai/iam")).toBe("hanzoai/iam");
	});
});

describe("brandOrg", () => {
	it("canonicalizes a known image namespace to its brand org", () => {
		expect(brandOrg("hanzoai")).toBe("hanzo");
		expect(brandOrg("zooai")).toBe("zoo");
		expect(brandOrg("luxfi")).toBe("lux");
	});
	it("passes an unknown namespace through unchanged (not a Hanzo product)", () => {
		expect(brandOrg("grafana")).toBe("grafana");
		expect(brandOrg("getmeili")).toBe("getmeili");
	});
});

describe("declaredOrg / orgForService", () => {
	const repo = "ghcr.io/hanzoai/iam";
	it("reads an explicit `hanzo.ai/org` label", () => {
		expect(
			declaredOrg({ metadata: { name: "x", labels: { "hanzo.ai/org": "hanzo" } } }),
		).toBe("hanzo");
	});
	it("reads an explicit `hanzo.ai/org` annotation", () => {
		expect(
			declaredOrg({
				metadata: { name: "x", annotations: { "hanzo.ai/org": "lux" } },
			}),
		).toBe("lux");
	});
	it("is undefined when neither label nor annotation is set", () => {
		expect(declaredOrg({ metadata: { name: "x" } })).toBeUndefined();
	});
	it("prefers the explicit label over the brand-canonicalized namespace", () => {
		expect(
			orgForService({ metadata: { name: "x", labels: { "hanzo.ai/org": "acme" } } }, repo),
		).toBe("acme");
	});
	it("falls back to the brand org of the image namespace", () => {
		expect(orgForService({ metadata: { name: "x" } }, repo)).toBe("hanzo");
	});
});

describe("healthFromDeployment", () => {
	it("green when all desired replicas are ready", () => {
		expect(
			healthFromDeployment({ spec: { replicas: 2 }, status: { readyReplicas: 2 } }),
		).toBe("green");
	});
	it("yellow when only some replicas are ready", () => {
		expect(
			healthFromDeployment({ spec: { replicas: 3 }, status: { readyReplicas: 1 } }),
		).toBe("yellow");
	});
	it("red when desired > 0 but none are ready", () => {
		expect(
			healthFromDeployment({ spec: { replicas: 2 }, status: { readyReplicas: 0 } }),
		).toBe("red");
	});
	it("yellow when intentionally scaled to zero (nothing running, not unhealthy)", () => {
		expect(
			healthFromDeployment({ spec: { replicas: 0 }, status: {} }),
		).toBe("yellow");
	});
	it("null when there is no Deployment at all", () => {
		expect(healthFromDeployment(null)).toBeNull();
	});
});

describe("runningTagFromDeployment", () => {
	const declaredRepo = "ghcr.io/hanzoai/chat";

	it("picks the container whose image repo matches the declared repo", () => {
		const dep = {
			spec: {
				template: {
					spec: {
						containers: [
							{ image: "ghcr.io/hanzoai/replicate:v1.0.0" }, // sidecar
							{ image: "ghcr.io/hanzoai/chat:0.7.10" }, // the app
						],
					},
				},
			},
		};
		expect(runningTagFromDeployment(dep, declaredRepo)).toBe("0.7.10");
	});

	it("falls back to the first container when no repo matches", () => {
		const dep = {
			spec: {
				template: { spec: { containers: [{ image: "ghcr.io/hanzoai/other:abc" }] } },
			},
		};
		expect(runningTagFromDeployment(dep, declaredRepo)).toBe("abc");
	});

	it("returns null when the matched image carries no tag", () => {
		const dep = {
			spec: {
				template: { spec: { containers: [{ image: "ghcr.io/hanzoai/chat" }] } },
			},
		};
		expect(runningTagFromDeployment(dep, declaredRepo)).toBeNull();
	});

	it("returns null when there are no containers", () => {
		expect(runningTagFromDeployment({ spec: { template: { spec: {} } } }, declaredRepo)).toBeNull();
		expect(runningTagFromDeployment(null, declaredRepo)).toBeNull();
	});
});

describe("observeService", () => {
	const cr = {
		metadata: { name: "chat" },
		spec: { image: { repository: "ghcr.io/hanzoai/chat", tag: "0.7.10" } },
	};
	const dep = {
		spec: {
			replicas: 1,
			template: {
				spec: { containers: [{ image: "ghcr.io/hanzoai/chat:0.7.9" }] },
			},
		},
		status: { readyReplicas: 1 },
	};

	it("maps a CR + Deployment into a fully-resolved ObservedApp (org brand-canonicalized)", () => {
		const app = observeService(cr, dep, "hanzo-k8s", "hanzo", "main");
		expect(app).toEqual({
			// `ghcr.io/hanzoai/chat` → org `hanzo` (brand org), NOT the raw `hanzoai`
			// namespace: the board must group first-party services under the IAM org.
			id: "hanzo/chat/main",
			org: "hanzo",
			app: "chat",
			env: "main",
			repo: "hanzoai/chat",
			registry: "ghcr.io/hanzoai/chat",
			declaredTag: "0.7.10",
			runningTag: "0.7.9", // un-rolled: cluster is one patch behind declared
			health: "green",
			cluster: "hanzo-k8s",
			namespace: "hanzo",
		});
	});

	it("honors an explicit `hanzo.ai/org` label over the image namespace", () => {
		const labeled = {
			metadata: { name: "chat", labels: { "hanzo.ai/org": "maxpower" } },
			spec: { image: { repository: "ghcr.io/hanzoai/chat", tag: "0.7.10" } },
		};
		const app = observeService(labeled, dep, "hanzo-k8s", "hanzo", "main");
		expect(app?.org).toBe("maxpower");
		expect(app?.id).toBe("maxpower/chat/main");
	});

	it("honors an explicit `hanzo.ai/org` annotation when there is no label", () => {
		const annotated = {
			metadata: { name: "chat", annotations: { "hanzo.ai/org": "hanzo" } },
			spec: { image: { repository: "docker.io/library/redis", tag: "7" } },
		};
		const app = observeService(annotated, null, "hanzo-k8s", "hanzo", "main");
		expect(app?.org).toBe("hanzo");
	});

	it("records declared-but-not-running when there is no Deployment", () => {
		const app = observeService(cr, null, "hanzo-k8s", "hanzo", "main");
		expect(app?.declaredTag).toBe("0.7.10");
		expect(app?.runningTag).toBeNull();
		expect(app?.health).toBeNull();
	});

	it("skips a CR with no image repository (nothing to track)", () => {
		expect(
			observeService({ metadata: { name: "x" }, spec: {} }, null, "c", "n", "main"),
		).toBeNull();
	});
});

describe("discoverApps", () => {
	it("joins Service CRs with Deployments by name across namespaces", async () => {
		const fakeClients = {
			custom: {
				listNamespacedCustomObject: async ({ namespace }: { namespace: string }) => {
					if (namespace === "hanzo") {
						return {
							items: [
								{
									metadata: { name: "iam" },
									spec: { image: { repository: "ghcr.io/hanzoai/iam", tag: "1.19.5" } },
								},
								{
									metadata: { name: "kms" },
									spec: {
										image: { repository: "ghcr.io/hanzoai/kms", tag: "multi-issuer" },
									},
								},
							],
						};
					}
					return { items: [] };
				},
			},
			apps: {
				listNamespacedDeployment: async ({ namespace }: { namespace: string }) => {
					if (namespace === "hanzo") {
						return {
							items: [
								{
									metadata: { name: "iam" },
									spec: {
										replicas: 1,
										template: {
											spec: { containers: [{ image: "ghcr.io/hanzoai/iam:1.19.5" }] },
										},
									},
									status: { readyReplicas: 1 },
								},
								// no Deployment for kms — declared but not running
							],
						};
					}
					return { items: [] };
				},
			},
		};

		const target: ClusterTarget = {
			cluster: "hanzo-k8s",
			namespaces: { hanzo: "main" },
		};

		// biome-ignore lint/suspicious/noExplicitAny: minimal fake of K8sClients
		const apps = await discoverApps(target, fakeClients as any);
		expect(apps).toHaveLength(2);

		const iam = apps.find((a) => a.app === "iam")!;
		expect(iam.declaredTag).toBe("1.19.5");
		expect(iam.runningTag).toBe("1.19.5");
		expect(iam.health).toBe("green");

		const kms = apps.find((a) => a.app === "kms")!;
		expect(kms.declaredTag).toBe("multi-issuer"); // recorded verbatim (drift flags it)
		expect(kms.runningTag).toBeNull();
		expect(kms.health).toBeNull();
	});
});
