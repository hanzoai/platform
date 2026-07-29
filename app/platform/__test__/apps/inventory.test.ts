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

import { db } from "@hanzo/platform/db";
import {
	type ClusterTarget,
	declaredOrg,
	discoverApps,
	discoverNamespaces,
	healthFromDeployment,
	observeService,
	orgForService,
	pruneMissing,
	runningTagFromDeployment,
} from "@hanzo/platform/services/apps/inventory";
import {
	brandOrg,
	nsClass,
	orgFromRepository,
	repoFromRepository,
} from "@hanzo/platform/services/apps/observed";
import { describe, expect, it, vi } from "vitest";

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
			declaredOrg({
				metadata: { name: "x", labels: { "hanzo.ai/org": "hanzo" } },
			}),
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
			orgForService(
				{ metadata: { name: "x", labels: { "hanzo.ai/org": "acme" } } },
				repo,
			),
		).toBe("acme");
	});
	it("falls back to the brand org of the image namespace", () => {
		expect(orgForService({ metadata: { name: "x" } }, repo)).toBe("hanzo");
	});
});

describe("healthFromDeployment", () => {
	it("green when all desired replicas are ready", () => {
		expect(
			healthFromDeployment({
				spec: { replicas: 2 },
				status: { readyReplicas: 2 },
			}),
		).toBe("green");
	});
	it("yellow when only some replicas are ready", () => {
		expect(
			healthFromDeployment({
				spec: { replicas: 3 },
				status: { readyReplicas: 1 },
			}),
		).toBe("yellow");
	});
	it("red when desired > 0 but none are ready", () => {
		expect(
			healthFromDeployment({
				spec: { replicas: 2 },
				status: { readyReplicas: 0 },
			}),
		).toBe("red");
	});
	it("yellow when intentionally scaled to zero (nothing running, not unhealthy)", () => {
		expect(healthFromDeployment({ spec: { replicas: 0 }, status: {} })).toBe(
			"yellow",
		);
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
				template: {
					spec: { containers: [{ image: "ghcr.io/hanzoai/other:abc" }] },
				},
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
		expect(
			runningTagFromDeployment(
				{ spec: { template: { spec: {} } } },
				declaredRepo,
			),
		).toBeNull();
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
			// The identity is WHERE IT RUNS. `<org>/<app>/<env>` collides across the
			// fleet (the release `cloud` runs in three namespaces at once), so the
			// row is keyed by cluster/namespace/name and `org` is an attribute.
			id: "hanzo-k8s/hanzo/chat",
			// `ghcr.io/hanzoai/chat` → org `hanzo` (brand org), NOT the raw `hanzoai`
			// namespace: the board must group first-party services under the IAM org.
			org: "hanzo",
			app: "chat",
			env: "main",
			repo: "hanzoai/chat",
			registry: "ghcr.io/hanzoai/chat",
			declaredTag: "0.7.10",
			runningTag: "0.7.9", // un-rolled: cluster is one patch behind declared
			health: "green",
			// The cluster cannot answer "does this match git" — only CD can, and it
			// supplies these two in the merge.
			syncStatus: null,
			syncRevision: null,
			cluster: "hanzo-k8s",
			namespace: "hanzo",
			// This CR declares no ingress, so it publishes no public hostname. The
			// board renders "—" for it; an internal service is not a broken one.
			hosts: [],
		});
	});

	it("carries the CR's published ingress hosts onto the row", () => {
		const routed = {
			metadata: { name: "chat" },
			spec: {
				image: { repository: "ghcr.io/hanzoai/chat", tag: "0.7.10" },
				ingress: { enabled: true, hosts: ["chat.hanzo.ai", "hanzo.chat"] },
			},
		};
		expect(
			observeService(routed, dep, "hanzo-k8s", "hanzo", "main")?.hosts,
		).toEqual(["chat.hanzo.ai", "hanzo.chat"]);
	});

	it("reports no hosts when ingress is explicitly disabled (stale hosts must not leak)", () => {
		const disabled = {
			metadata: { name: "chat" },
			spec: {
				image: { repository: "ghcr.io/hanzoai/chat", tag: "0.7.10" },
				ingress: { enabled: false, hosts: ["chat.hanzo.ai"] },
			},
		};
		expect(
			observeService(disabled, dep, "hanzo-k8s", "hanzo", "main")?.hosts,
		).toEqual([]);
	});

	it("honors an explicit `hanzo.ai/org` label over the image namespace", () => {
		const labeled = {
			metadata: { name: "chat", labels: { "hanzo.ai/org": "maxpower" } },
			spec: { image: { repository: "ghcr.io/hanzoai/chat", tag: "0.7.10" } },
		};
		const app = observeService(labeled, dep, "hanzo-k8s", "hanzo", "main");
		expect(app?.org).toBe("maxpower");
		// Attribution does NOT move the row: identity is where it runs, so a
		// re-attributed app keeps its id and simply changes org.
		expect(app?.id).toBe("hanzo-k8s/hanzo/chat");
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
			observeService(
				{ metadata: { name: "x" }, spec: {} },
				null,
				"c",
				"n",
				"main",
			),
		).toBeNull();
	});
});

describe("discoverApps", () => {
	it("joins Service CRs with Deployments by name across namespaces", async () => {
		const fakeClients = {
			custom: {
				listNamespacedCustomObject: async ({
					namespace,
				}: {
					namespace: string;
				}) => {
					if (namespace === "hanzo") {
						return {
							items: [
								{
									metadata: { name: "iam" },
									spec: {
										image: { repository: "ghcr.io/hanzoai/iam", tag: "1.19.5" },
									},
								},
								{
									metadata: { name: "kms" },
									spec: {
										image: {
											repository: "ghcr.io/hanzoai/kms",
											tag: "multi-issuer",
										},
									},
								},
							],
						};
					}
					return { items: [] };
				},
			},
			apps: {
				listNamespacedDeployment: async ({
					namespace,
				}: {
					namespace: string;
				}) => {
					if (namespace === "hanzo") {
						return {
							items: [
								{
									metadata: { name: "iam" },
									spec: {
										replicas: 1,
										template: {
											spec: {
												containers: [{ image: "ghcr.io/hanzoai/iam:1.19.5" }],
											},
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
				listNamespacedStatefulSet: async () => ({ items: [] }),
			},
		};

		const target: ClusterTarget = {
			cluster: "hanzo-k8s",
			namespaces: { hanzo: "main" },
		};

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

	it("resolves a StatefulSet-backed app (kv/sql) like a Deployment-backed one", async () => {
		// Listing only Deployments left `kv`/`sql` with a null running tag and null
		// health forever — they are StatefulSets. Both kinds carry the same
		// replicas/containers/readyReplicas shape, so one index serves both.
		const fakeClients = {
			custom: {
				listNamespacedCustomObject: async () => ({
					items: [
						{
							metadata: { name: "kv" },
							spec: {
								image: { repository: "ghcr.io/hanzoai/kv", tag: "v1.4.0" },
							},
						},
					],
				}),
			},
			apps: {
				listNamespacedDeployment: async () => ({ items: [] }),
				listNamespacedStatefulSet: async () => ({
					items: [
						{
							metadata: { name: "kv" },
							spec: {
								replicas: 3,
								template: {
									spec: {
										containers: [{ image: "ghcr.io/hanzoai/kv:v1.4.0" }],
									},
								},
							},
							status: { readyReplicas: 3 },
						},
					],
				}),
			},
		};

		const target: ClusterTarget = {
			cluster: "hanzo-k8s",
			namespaces: { hanzo: "main" },
		};
		const apps = await discoverApps(target, fakeClients as any);

		expect(apps).toHaveLength(1);
		expect(apps[0]!.runningTag).toBe("v1.4.0");
		expect(apps[0]!.health).toBe("green");
	});

	it("drops a route-only CR (no spec.image) instead of emitting an undrifted row", async () => {
		// `hanzo-domains` / `hanzo-app-sites` declare ingress for OTHER services and
		// run no workload: no declared tag, no running tag, no health.
		const fakeClients = {
			custom: {
				listNamespacedCustomObject: async () => ({
					items: [
						{
							metadata: { name: "hanzo-domains" },
							spec: { domains: [{ domain: "api.hanzo.ai" }] },
						},
					],
				}),
			},
			apps: {
				listNamespacedDeployment: async () => ({ items: [] }),
				listNamespacedStatefulSet: async () => ({ items: [] }),
			},
		};

		const target: ClusterTarget = {
			cluster: "hanzo-k8s",
			namespaces: { hanzo: "main" },
		};
		expect(await discoverApps(target, fakeClients as any)).toHaveLength(0);
	});

	it("DISCOVERS the scan set when the target pins no namespaces", async () => {
		// The regression this closes: the scan set was a hardcoded 3-namespace map,
		// so `tenant-*` App CRs were structurally invisible however they were labelled.
		const scanned: string[] = [];
		const fakeClients = {
			core: {
				listNamespace: async () => ({
					items: [
						{ metadata: { name: "hanzo" } },
						{ metadata: { name: "tenant-maxpower" } },
						{ metadata: { name: "kube-system" } }, // not ours
					],
				}),
			},
			custom: {
				listNamespacedCustomObject: async ({
					namespace,
				}: {
					namespace: string;
				}) => {
					scanned.push(namespace);
					return namespace === "tenant-maxpower"
						? {
								items: [
									{
										metadata: {
											name: "hello",
											labels: { "hanzo.ai/org": "maxpower" },
										},
										spec: {
											image: {
												repository: "ghcr.io/maxpower/hello",
												tag: "v1",
											},
										},
									},
								],
							}
						: { items: [] };
				},
			},
			apps: {
				listNamespacedDeployment: async () => ({ items: [] }),
				listNamespacedStatefulSet: async () => ({ items: [] }),
			},
		};

		const apps = await discoverApps(
			{ cluster: "hanzo-k8s" },
			fakeClients as any,
		);

		expect(scanned).toContain("tenant-maxpower");
		expect(scanned).not.toContain("kube-system");
		expect(apps.map((a) => a.id)).toEqual(["hanzo-k8s/tenant-maxpower/hello"]);
	});
});

describe("nsClass", () => {
	it("classifies the first-party namespaces to their env", () => {
		expect(nsClass("hanzo")).toEqual({ tenant: "hanzo", env: "main" });
		expect(nsClass("hanzo-mainnet")).toEqual({ tenant: "hanzo", env: "main" });
		expect(nsClass("hanzo-testnet")).toEqual({ tenant: "hanzo", env: "test" });
		expect(nsClass("hanzo-devnet")).toEqual({ tenant: "hanzo", env: "dev" });
	});
	it("classifies tenant-<org> with the org as the tenant key", () => {
		expect(nsClass("tenant-maxpower")).toEqual({
			tenant: "maxpower",
			env: "main",
		});
		expect(nsClass("tenant-hanzo")).toEqual({ tenant: "hanzo", env: "main" });
	});
	it("classifies everything else OUT (total, fail-closed)", () => {
		for (const ns of [
			"kube-system",
			"argocd",
			"default",
			"tenant-",
			"",
			"hanzo-superbase",
		]) {
			expect(nsClass(ns)).toBeNull();
		}
	});
});

describe("discoverNamespaces", () => {
	const clientsListing = (names: string[]) =>
		({
			core: {
				listNamespace: async () => ({
					items: names.map((n) => ({ metadata: { name: n } })),
				}),
			},
		}) as any;

	it("keeps only recognised namespaces, first-party first", async () => {
		const set = await discoverNamespaces(
			clientsListing([
				"tenant-maxpower",
				"kube-system",
				"hanzo",
				"hanzo-devnet",
			]),
		);
		expect(set).toEqual({
			hanzo: "main",
			"hanzo-testnet": "test",
			"hanzo-devnet": "dev",
			"tenant-maxpower": "main",
		});
		// first-party leads, so a bare app name still resolves to production first
		expect(Object.keys(set)[0]).toBe("hanzo");
	});

	it("falls back to first-party (never wider) when the list fails", async () => {
		const clients = {
			core: {
				listNamespace: async () => {
					throw new Error("forbidden");
				},
			},
		} as any;
		expect(await discoverNamespaces(clients)).toEqual({
			hanzo: "main",
			"hanzo-testnet": "test",
			"hanzo-devnet": "dev",
		});
	});

	it("always includes first-party even if the cluster list omits it", async () => {
		const set = await discoverNamespaces(clientsListing(["tenant-acme"]));
		expect(set.hanzo).toBe("main");
		expect(set["tenant-acme"]).toBe("main");
	});
});

describe("pruneMissing", () => {
	/** Stub the `select … from(apps).where(cluster)` read with a fixed row set. */
	const withRows = (rows: Array<{ id: string; namespace: string | null }>) => {
		const read = { from: () => ({ where: () => Promise.resolve(rows) }) };
		vi.mocked(db.select).mockReturnValueOnce(read as never);
		// Count DELETEs; each terminates with `.where(...).run()`.
		const deletes = vi.fn(() => ({ where: () => ({ run: () => undefined }) }));
		vi.mocked(db.delete).mockImplementation(deletes as never);
		return deletes;
	};
	const HANZO = new Set(["hanzo"]);

	it("deletes exactly the rows whose CR is gone, and keeps the observed ones", async () => {
		const deletes = withRows([
			{ id: "hanzo/console/main", namespace: "hanzo" },
			{ id: "hanzo/whoami/main", namespace: "hanzo" }, // CR deleted from the cluster
			{ id: "traefik/whoami/main", namespace: "hanzo" }, // CR deleted from the cluster
		]);

		const pruned = await pruneMissing(
			"hanzo-k8s",
			new Set(["hanzo/console/main"]),
			HANZO,
		);

		expect(pruned).toBe(2);
		expect(deletes).toHaveBeenCalledTimes(2);
	});

	it("is a no-op when every stored row was observed (steady state)", async () => {
		const deletes = withRows([
			{ id: "hanzo/console/main", namespace: "hanzo" },
			{ id: "hanzo/cloud/main", namespace: "hanzo" },
		]);

		const pruned = await pruneMissing(
			"hanzo-k8s",
			new Set(["hanzo/console/main", "hanzo/cloud/main"]),
			HANZO,
		);

		expect(pruned).toBe(0);
		expect(deletes).not.toHaveBeenCalled();
	});

	it("prunes a renamed row: the id embeds the namespace, so a moved app orphans the old id", async () => {
		// `chat-meilisearch` moved namespace; the row is written under a NEW id and
		// the old one must not linger on the board as a phantom duplicate.
		const deletes = withRows([
			{ id: "hanzo-k8s/hanzo/chat-meilisearch", namespace: "hanzo" },
			{ id: "hanzo-k8s/hanzo/search", namespace: "hanzo" },
		]);

		const pruned = await pruneMissing(
			"hanzo-k8s",
			new Set(["hanzo-k8s/hanzo/search"]),
			HANZO,
		);

		expect(pruned).toBe(1);
		expect(deletes).toHaveBeenCalledTimes(1);
	});

	it("NEVER touches a namespace this pass did not scan (a discovery blip must not wipe tenants)", async () => {
		// `discoverNamespaces` narrows fail-safe to first-party on a list error, so
		// a tenant namespace can vanish from the scan set while its apps are alive.
		// Unscanned namespace ⇒ no evidence ⇒ no delete.
		const deletes = withRows([
			{ id: "hanzo/console/main", namespace: "hanzo" },
			{ id: "maxpower/api/main", namespace: "tenant-maxpower" },
			{ id: "maxpower/web/main", namespace: "tenant-maxpower" },
		]);

		const pruned = await pruneMissing(
			"hanzo-k8s",
			new Set(["hanzo/console/main"]),
			HANZO, // tenant-maxpower was NOT scanned this pass
		);

		expect(pruned).toBe(0);
		expect(deletes).not.toHaveBeenCalled();
	});

	it("never reaches rows belonging to another cluster (seeded cross-cluster estate is safe)", async () => {
		// The `where(eq(apps.cluster, …))` scope is what protects the directly-seeded
		// lux-k8s / zoo-k8s rows: a hanzo-k8s pass simply never reads them.
		const deletes = withRows([
			{ id: "hanzo/console/main", namespace: "hanzo" },
		]);

		const pruned = await pruneMissing(
			"hanzo-k8s",
			new Set(["hanzo/console/main"]),
			HANZO,
		);

		expect(pruned).toBe(0);
		expect(deletes).not.toHaveBeenCalled();
	});
});
