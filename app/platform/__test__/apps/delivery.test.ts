/**
 * Unit tests for the delivery reader (services/apps/delivery) — the half of the
 * fleet observation that covers every cluster platform CANNOT read directly.
 *
 * The fixtures are the real shapes measured on `hanzo-cd`: a hanzo fleet app
 * (single source, in-cluster), a lux app (multi-source, remote, org-labelled),
 * and a zoo app whose live tree reports no image at all. If these mappings are
 * wrong, lux and zoo are either missing from the board or attributed to the
 * wrong org — the two failures this reader exists to prevent.
 */

import {
	type CdApplication,
	clusterOf,
	healthOf,
	observeDelivered,
	orgOf,
	primaryImage,
	releaseOf,
	serverProjects,
	syncOf,
} from "@hanzo/platform/services/apps/delivery";
import { mergeObserved } from "@hanzo/platform/services/apps/observed";
import { describe, expect, it } from "vitest";

const LOCAL = "https://kubernetes.default.svc";
const LUX_SERVER = "https://04c46df5.k8s.ondigitalocean.com";
const ZOO_SERVER = "https://d2c321c9.k8s.ondigitalocean.com";

/** A hanzo fleet app: generated in-cluster, no org label, one source. */
const hanzoApp: CdApplication = {
	metadata: { name: "hanzo-a", labels: { "apps.hanzo.ai/plane": "fleet" } },
	spec: {
		project: "hanzo-platform",
		destination: { server: LOCAL, namespace: "hanzo" },
		source: {
			repoURL: "github.com/hanzoai/universe",
			helm: { releaseName: "a" },
		},
	},
	status: {
		sync: { status: "OutOfSync", revision: "45b18012e0f" },
		health: { status: "Healthy" },
		summary: { images: ["ghcr.io/hanzoai/a:v0.1.0"] },
	},
};

/** A lux app: remote cluster, org label, chart + values as two sources. */
const luxApp: CdApplication = {
	metadata: {
		name: "lux-app-lux-finance-app-lux-finance",
		labels: { "apps.hanzo.ai/org": "lux" },
	},
	spec: {
		project: "lux",
		destination: { server: LUX_SERVER, namespace: "app-lux-finance" },
		sources: [
			{ chart: "app", helm: { releaseName: "app-lux-finance" } },
			{ repoURL: "github.com/luxfi/universe" },
		],
	},
	status: {
		sync: { status: "Synced" },
		health: { status: "Healthy" },
		summary: { images: ["ghcr.io/luxfi/finance:1.0.3-amd64"] },
	},
};

const projects = [
	{
		metadata: { name: "lux" },
		spec: { destinations: [{ server: LUX_SERVER }] },
	},
	{
		metadata: { name: "zoo" },
		spec: { destinations: [{ server: ZOO_SERVER }] },
	},
	{
		metadata: { name: "hanzo-platform" },
		spec: { destinations: [{ server: LOCAL, namespace: "*" }] },
	},
	{
		metadata: { name: "default" },
		spec: { destinations: [{ server: "*", namespace: "*" }] },
	},
];

describe("syncOf", () => {
	it("maps CD's verdict into ours", () => {
		expect(syncOf(hanzoApp)).toBe("drifted");
		expect(syncOf(luxApp)).toBe("synced");
	});
	it("treats a missing or literal-Unknown status as unknown, never as synced", () => {
		expect(syncOf({})).toBe("unknown");
		expect(syncOf({ status: { sync: { status: "Unknown" } } })).toBe("unknown");
	});
});

describe("healthOf", () => {
	it("maps CD's health vocabulary onto the board's", () => {
		expect(healthOf(hanzoApp)).toBe("green");
		expect(healthOf({ status: { health: { status: "Progressing" } } })).toBe(
			"yellow",
		);
		expect(healthOf({ status: { health: { status: "Degraded" } } })).toBe(
			"red",
		);
		expect(healthOf({ status: { health: { status: "Missing" } } })).toBe("red");
	});
	it("is null when CD reported nothing — unobserved is not healthy", () => {
		expect(healthOf({})).toBeNull();
	});
});

describe("releaseOf", () => {
	it("takes the Helm release name, not the generated Application name", () => {
		expect(releaseOf(hanzoApp)).toBe("a");
		expect(releaseOf(luxApp)).toBe("app-lux-finance");
	});
	it("falls back to the Application name when no source declares a release", () => {
		expect(releaseOf({ metadata: { name: "universe-crs" }, spec: {} })).toBe(
			"universe-crs",
		);
	});
});

describe("primaryImage", () => {
	it("picks the image whose name matches the release, ignoring sidecars", () => {
		const withSidecar: CdApplication = {
			...hanzoApp,
			status: {
				...hanzoApp.status,
				summary: {
					images: ["busybox:1.36", "ghcr.io/hanzoai/index:sha-d0ad9f9"],
				},
			},
		};
		expect(primaryImage(withSidecar, "index")).toBe(
			"ghcr.io/hanzoai/index:sha-d0ad9f9",
		);
	});
	it("takes a lone image even when it does not match the release name", () => {
		expect(primaryImage(luxApp, "app-lux-finance")).toBe(
			"ghcr.io/luxfi/finance:1.0.3-amd64",
		);
	});
	it("is null for a bundle of unmatched images — no single identity to claim", () => {
		const bundle: CdApplication = {
			metadata: { name: "universe" },
			spec: { destination: { server: LOCAL, namespace: "hanzo" } },
			status: { summary: { images: ["grafana/grafana:11", "prom/prom:v1"] } },
		};
		expect(primaryImage(bundle, "universe")).toBeNull();
	});
	it("is null when CD reported no images at all", () => {
		expect(primaryImage({}, "anything")).toBeNull();
	});
});

describe("serverProjects", () => {
	it("names a remote cluster by the project that pins exactly that server", () => {
		const map = serverProjects(projects);
		expect(map.get(LUX_SERVER)).toBe("lux");
		expect(map.get(ZOO_SERVER)).toBe("zoo");
	});
	it("never names the local server — every first-party project pins it", () => {
		expect(serverProjects(projects).has(LOCAL)).toBe(false);
	});
	it("skips a wildcard project: it pins no single cluster", () => {
		expect([...serverProjects(projects).values()]).not.toContain("default");
	});
});

describe("clusterOf", () => {
	const map = serverProjects(projects);
	it("uses the local cluster's own name for an in-cluster destination", () => {
		expect(clusterOf(hanzoApp, map, "hanzo-k8s")).toBe("hanzo-k8s");
	});
	it("names a remote destination by its pinning project", () => {
		expect(clusterOf(luxApp, map, "hanzo-k8s")).toBe("lux");
	});
	it("honors an explicit cluster label over any inference", () => {
		expect(
			clusterOf(
				{ metadata: { labels: { "apps.hanzo.ai/cluster": "hanzo-k8s" } } },
				map,
				"other",
			),
		).toBe("hanzo-k8s");
	});
	it("falls back to the server host rather than inventing a name", () => {
		const unknownServer: CdApplication = {
			spec: {
				destination: { server: "https://elsewhere.example/", namespace: "x" },
			},
		};
		expect(clusterOf(unknownServer, map, "hanzo-k8s")).toBe(
			"elsewhere.example",
		);
	});
});

describe("orgOf", () => {
	it("honors the org label the generating ApplicationSet stamps", () => {
		expect(orgOf(luxApp, "ghcr.io/hanzoai/cloud:v1", "hanzo")).toBe("lux");
	});
	it("reads a tenant-<org> namespace as its own owner", () => {
		const tenant: CdApplication = {
			metadata: { name: "tenant-maxpower-maxpower-site" },
			spec: { destination: { server: LOCAL, namespace: "tenant-maxpower" } },
		};
		expect(orgOf(tenant, "ghcr.io/hanzoai/spa:v1", "hanzo")).toBe("maxpower");
	});
	it("brand-canonicalizes the image namespace when nothing else declares", () => {
		const bare: CdApplication = {
			spec: { destination: { server: LUX_SERVER, namespace: "lux-mainnet" } },
		};
		expect(orgOf(bare, "ghcr.io/zooai/ngo:main", "hanzo")).toBe("zoo");
	});
	it("uses the CD project before the install's own org", () => {
		const bare: CdApplication = {
			spec: {
				project: "lux",
				destination: { server: LUX_SERVER, namespace: "lux-mainnet" },
			},
		};
		expect(orgOf(bare, null, "hanzo")).toBe("lux");
	});
});

describe("observeDelivered", () => {
	const map = serverProjects(projects);

	it("maps a remote lux app into a fully-attributed row", () => {
		expect(observeDelivered(luxApp, map, "hanzo-k8s", "hanzo")).toEqual({
			id: "lux/app-lux-finance/app-lux-finance",
			org: "lux",
			app: "app-lux-finance",
			env: "main",
			repo: "luxfi/finance",
			registry: "ghcr.io/luxfi/finance",
			// CD reports what is RUNNING and whether it matches git — never what git
			// declares right now. Filling `declaredTag` from the running tag would
			// make every remote app read "no drift" by construction.
			declaredTag: null,
			runningTag: "1.0.3-amd64",
			health: "green",
			syncStatus: "synced",
			syncRevision: null,
			cluster: "lux",
			namespace: "app-lux-finance",
			hosts: [],
		});
	});

	it("derives env from the namespace suffix, for any org", () => {
		const testnet: CdApplication = {
			metadata: { labels: { "apps.hanzo.ai/org": "zoo" } },
			spec: {
				destination: { server: ZOO_SERVER, namespace: "zoo-testnet" },
				sources: [{ helm: { releaseName: "explorer" } }],
			},
		};
		expect(observeDelivered(testnet, map, "hanzo-k8s", "hanzo")?.env).toBe(
			"test",
		);
	});

	it("keeps an app whose live tree reports no image, with unknown repo", () => {
		const imageless: CdApplication = {
			metadata: { labels: { "apps.hanzo.ai/org": "zoo" } },
			spec: {
				destination: { server: ZOO_SERVER, namespace: "zoo-mainnet" },
				sources: [{ helm: { releaseName: "zoo-docs" } }],
			},
			status: { sync: { status: "OutOfSync" }, health: { status: "Missing" } },
		};
		const row = observeDelivered(imageless, map, "hanzo-k8s", "hanzo");
		expect(row?.id).toBe("zoo/zoo-mainnet/zoo-docs");
		// Unobservable, so null — never an invented registry path.
		expect(row?.repo).toBeNull();
		expect(row?.registry).toBeNull();
		expect(row?.runningTag).toBeNull();
		expect(row?.health).toBe("red");
	});

	it("drops an Application with no destination namespace — it runs nowhere", () => {
		expect(
			observeDelivered(
				{ metadata: { name: "x" }, spec: {} },
				map,
				"c",
				"hanzo",
			),
		).toBeNull();
	});

	it("gives the SAME id a directly-observed app would get, so the two merge", () => {
		expect(observeDelivered(hanzoApp, map, "hanzo-k8s", "hanzo")?.id).toBe(
			"hanzo-k8s/hanzo/a",
		);
	});
});

describe("mergeObserved", () => {
	const direct = {
		id: "hanzo-k8s/hanzo/a",
		org: "hanzo",
		app: "a",
		env: "main" as const,
		repo: "hanzoai/a",
		registry: "ghcr.io/hanzoai/a",
		declaredTag: "v0.1.0",
		runningTag: "v0.1.0",
		health: "green" as const,
		syncStatus: null,
		syncRevision: null,
		cluster: "hanzo-k8s",
		namespace: "hanzo",
		hosts: ["a.hanzo.ai"],
	};

	it("keeps the direct reader's evidence and takes only sync from the deployer", () => {
		const delivered = observeDelivered(
			hanzoApp,
			serverProjects(projects),
			"hanzo-k8s",
			"hanzo",
		)!;
		const [row] = mergeObserved([direct], [delivered]);
		expect(row).toMatchObject({
			id: "hanzo-k8s/hanzo/a",
			declaredTag: "v0.1.0", // only the CR knows this
			hosts: ["a.hanzo.ai"], // only the CR knows this
			syncStatus: "drifted", // only CD knows this
			syncRevision: "45b18012e0f",
		});
	});

	it("carries an app only one reader saw, from either side", () => {
		const delivered = observeDelivered(
			luxApp,
			serverProjects(projects),
			"hanzo-k8s",
			"hanzo",
		)!;
		const ids = mergeObserved([direct], [delivered])
			.map((r) => r.id)
			.sort();
		expect(ids).toEqual([
			"hanzo-k8s/hanzo/a",
			"lux/app-lux-finance/app-lux-finance",
		]);
	});

	it("never lets a null from the direct reader erase what the deployer saw", () => {
		const blind = { ...direct, runningTag: null, health: null, hosts: [] };
		const delivered = observeDelivered(
			hanzoApp,
			serverProjects(projects),
			"hanzo-k8s",
			"hanzo",
		)!;
		const [row] = mergeObserved([blind], [delivered]);
		expect(row?.runningTag).toBe("v0.1.0");
		expect(row?.health).toBe("green");
	});
});
