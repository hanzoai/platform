import {
	buildBuildkitJob,
	buildJobName,
	buildkitArgs,
	buildkitWrapperScript,
	buildNamespace,
	parseImageDigest,
} from "@hanzo/platform/services/ci/buildkit-job";
import { afterEach, describe, expect, it } from "vitest";

type Vol = {
	name: string;
	secret?: { secretName: string; items: { key: string; path: string }[] };
	emptyDir?: Record<string, unknown>;
};
type Mount = { name: string; mountPath: string; readOnly?: boolean };

/**
 * buildkit-job is the single build muscle. These tests pin the BuildKit Job
 * contract (dockerfile.v0 frontend, HTTPS git context, image output, auth
 * secrets, runner pool, privileged) that the hand-applied build Jobs proved —
 * so bridging the scheduler to it produces the SAME build a human would have
 * applied by hand to build commerce/chat/cloud on this cluster.
 */
describe("buildJobName", () => {
	it("is RFC1123-safe and <=63 chars", () => {
		const name = buildJobName("hanzoai/Pricing_Service", "AbC_123-xyz456789");
		expect(name).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
		expect(name.length).toBeLessThanOrEqual(63);
		expect(name.startsWith("build-pricing-service-")).toBe(true);
	});

	it("is deterministic on (repo, buildJobId)", () => {
		expect(buildJobName("hanzoai/pricing", "abc12345")).toBe(
			buildJobName("hanzoai/pricing", "abc12345"),
		);
	});
});

describe("buildkitArgs", () => {
	it("emits the proven dockerfile.v0 git-context build contract", () => {
		const args = buildkitArgs({
			repo: "hanzoai/pricing",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/pricing:v1.2.3",
			buildJobId: "j1",
		});
		// DEFAULT is the in-pod build: no BUILDKITD_ADDR, so no `--addr` and
		// `build` leads. The previous version of this test pinned
		// `tcp://buildkitd-0.buildkitd.hanzo-build.svc…`, a Service that does not
		// resolve (NXDOMAIN — the StatefulSet spike behind it was retired), so it
		// asserted a contract under which every build fails at dial.
		expect(args[0]).toBe("build");
		expect(args).not.toContain("--addr");
		expect(args).toContain("--frontend=dockerfile.v0");
		expect(args).toContain(
			"--opt=context=https://github.com/hanzoai/pricing.git#refs/heads/main",
		);
		expect(args).toContain("--opt=filename=Dockerfile");
		expect(args).toContain("--opt=platform=linux/amd64");
		expect(args).toContain(
			"--output=type=image,name=ghcr.io/hanzoai/pricing:v1.2.3,push=true",
		);
		expect(args).toContain("--secret=id=GIT_AUTH_TOKEN,env=GIT_AUTH_TOKEN");
		expect(args).toContain("--progress=plain");
		// no sub-path or target for a root-context, single-stage build
		expect(args.some((a) => a.startsWith("--opt=context-subdir"))).toBe(false);
		expect(args.some((a) => a.startsWith("--opt=target="))).toBe(false);
	});

	// The Job no longer compiles anything — it is a gRPC client of the persistent
	// buildkitd — so every resource is requested AND limited at the same small
	// value: Guaranteed QoS. This subsumes the older ephemeral-storage-only rule,
	// which existed because a build that overran its 60Gi limit got its NEIGHBOURS
	// evicted (build-docs and pf-runner died for a third build's overrun, and four
	// commerce builds could not schedule at 24Gi apiece on an 88Gi node). A client
	// that cannot overrun cannot evict anyone.
	it("sizes the envelope to what the pod actually does", () => {
		const job = buildBuildkitJob({
			repo: "hanzoai/docs",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/docs:v1.2.3",
			buildJobId: "j1",
		});
		// IN-POD (default): this pod IS the builder, so it gets the builder's
		// envelope — the one that builds commerce/chat/cloud today. A 100m/256Mi
		// box running buildctl-daemonless.sh does not build slowly, it OOMs.
		const res = job.spec.template.spec.containers[0].resources;
		expect(res.requests.cpu).toBe("2");
		expect(res.requests.memory).toBe("6Gi");
		// ephemeral-storage requested AND limited alike: a build that overran its
		// limit got its NEIGHBOURS evicted, not itself.
		expect(res.limits["ephemeral-storage"]).toBe(
			res.requests["ephemeral-storage"],
		);

		// REMOTE: a gRPC client that cannot overrun cannot evict anyone.
		process.env.BUILDKITD_ADDR = "tcp://buildkitd-node.hanzo-build.svc:1234";
		try {
			const r = buildBuildkitJob({
				repo: "hanzoai/docs",
				gitRef: "refs/heads/main",
				image: "ghcr.io/hanzoai/docs:v1.2.3",
				buildJobId: "j1",
			}).spec.template.spec.containers[0].resources;
			expect(r.requests.cpu).toBe("100m");
			expect(r.requests.memory).toBe("256Mi");
			expect(r.limits.cpu).toBe(r.requests.cpu);
			expect(r.limits.memory).toBe(r.requests.memory);
		} finally {
			delete process.env.BUILDKITD_ADDR;
		}
	});

	// The builder's PVC is the cache now. The registry ref is kept ONLY as
	// cold-start seed for a replica with a fresh volume (1.2s when the local store
	// already has the layers). The EXPORT is deliberately gone: against a
	// persistent store it wrote a cache nothing reads, and mode=max made that
	// 221.3s of the 17-minute hanzo-inc/cloud build — 22% of the wall clock.
	it("imports, but never exports, the per-arch registry layer cache", () => {
		const args = buildkitArgs({
			repo: "hanzoai/docs",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/docs:v1.2.3",
			buildJobId: "j1",
		});
		expect(args).toContain(
			"--import-cache=type=registry,ref=ghcr.io/hanzoai/docs:buildcache-amd64",
		);
		expect(args.some((a) => a.startsWith("--export-cache"))).toBe(false);
	});

	// A cross-arch import is a guaranteed miss, so the two arches must not share
	// one ref. amd64 is the only arch with a builder today; the arm64 half of this
	// contract is pinned by the refusal test below.
	it("keys the cache per arch", () => {
		const args = buildkitArgs({
			repo: "hanzoai/docs",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/docs:v1.2.3",
			buildJobId: "j1",
		});
		expect(args).toContain(
			"--import-cache=type=registry,ref=ghcr.io/hanzoai/docs:buildcache-amd64",
		);
	});

	// Regression: without KEEP_GIT_DIR, BuildKit's git context has no .git, so a
	// Dockerfile's `git describe --tags` fails and the version silently falls back
	// to a checked-in (stale) file. The image is then tagged with the NEW version
	// while the binary reports an OLD one — a rollout that reads as a downgrade.
	// A luxfi/node build without this printed "Building Lux Node v1.32.11" while
	// building the v1.36.33 tag.
	it("keeps the .git dir in the context by default", () => {
		const args = buildkitArgs({
			repo: "luxfi/node",
			gitRef: "refs/tags/v1.36.35",
			image: "ghcr.io/luxfi/node:v1.36.35",
			buildJobId: "j1",
		});
		expect(args).toContain("--opt=build-arg:BUILDKIT_CONTEXT_KEEP_GIT_DIR=1");
	});

	it("lets an explicit buildArg override the KEEP_GIT_DIR default exactly once", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			buildJobId: "j",
			buildArgs: { BUILDKIT_CONTEXT_KEEP_GIT_DIR: "0" },
		});
		const emitted = args.filter((a) =>
			a.startsWith("--opt=build-arg:BUILDKIT_CONTEXT_KEEP_GIT_DIR="),
		);
		// exactly one — the caller's — so precedence is explicit rather than a bet
		// on which duplicate `--opt` BuildKit happens to keep.
		expect(emitted).toEqual([
			"--opt=build-arg:BUILDKIT_CONTEXT_KEEP_GIT_DIR=0",
		]);
	});

	// Regression: `ghcr.io/hanzoai/iam:v1.34.1` built through /v1/runner answered
	// `iam dev` from `/iam version` — the Dockerfile's `ARG VERSION=dev` default
	// was never overridden, so a running pod could not name its own release. The
	// forge workflow passed `--build-arg VERSION=<tag>`; platform did not, so one
	// commit built through two front doors self-reported two different versions.
	it("passes the destination tag as VERSION so the binary can name its release", () => {
		const args = buildkitArgs({
			repo: "hanzoai/iam",
			gitRef: "refs/tags/v1.34.1",
			image: "ghcr.io/hanzoai/iam:v1.34.1",
			buildJobId: "j1",
		});
		expect(args).toContain("--opt=build-arg:VERSION=v1.34.1");
	});

	it("lets an explicit VERSION win, emitted exactly once", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "ghcr.io/hanzoai/x:v9.9.9",
			buildJobId: "j",
			buildArgs: { VERSION: "1.2.3" },
		});
		expect(
			args.filter((a) => a.startsWith("--opt=build-arg:VERSION=")),
		).toEqual(["--opt=build-arg:VERSION=1.2.3"]);
	});

	// A digest names bytes, not a release. Passing the digest hex as VERSION
	// would be a lineage claim nothing backs.
	it("invents no VERSION for a digest-only destination", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "ghcr.io/hanzoai/x@sha256:0123456789abcdef",
			buildJobId: "j",
		});
		expect(args.some((a) => a.startsWith("--opt=build-arg:VERSION="))).toBe(
			false,
		);
	});

	it("reads the tag, not the digest, when a ref pins both", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "ghcr.io/hanzoai/x:v1.2.3@sha256:0123456789abcdef",
			buildJobId: "j",
		});
		expect(args).toContain("--opt=build-arg:VERSION=v1.2.3");
	});

	it("strips a leading ./ from the dockerfile", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			dockerfile: "./Dockerfile.production",
			buildJobId: "j",
		});
		expect(args).toContain("--opt=filename=Dockerfile.production");
	});

	it("adds context-subdir, target, and build-args when set", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			context: "services/api",
			dockerTarget: "runtime",
			buildArgs: { VERSION: "1.2.3" },
			buildJobId: "j",
		});
		expect(args).toContain("--opt=context-subdir=services/api");
		expect(args).toContain("--opt=target=runtime");
		expect(args).toContain("--opt=build-arg:VERSION=1.2.3");
	});

	// Cache mounts are namespaced per repo UNCONDITIONALLY — on the in-pod path
	// too, where it is inert, so the flag is a property of what this builder
	// emits rather than of which daemon happens to answer. Forgetting it on the
	// day an address is configured is exactly the kind of thing that does not get
	// remembered.
	it("namespaces cache mounts per repo on every path", () => {
		const args = buildkitArgs({
			repo: "hanzoai/pricing",
			gitRef: "main",
			image: "ghcr.io/hanzoai/pricing:t",
			buildJobId: "j",
		});
		expect(args).toContain(
			"--opt=build-arg:BUILDKIT_CACHE_MOUNT_NS=hanzoai/pricing",
		);
	});

	// The address and the credential are ONE decision. A dial with `--addr` and
	// no client certificate dies with "certificate required" against a daemon
	// that sets `ca` in [grpc.tls] — which ours does — so a build that reached
	// the daemon without these flags would fail 100% of the time. Emitting them
	// from one branch is what stops them drifting apart.
	it("emits address AND client certificate together, never one alone", () => {
		process.env.BUILDKITD_ADDR = "tcp://buildkitd-node.hanzo-build.svc:1234";
		try {
			const args = buildkitArgs({
				repo: "hanzoai/pricing",
				gitRef: "main",
				image: "ghcr.io/hanzoai/pricing:t",
				buildJobId: "j",
			});
			expect(args[0]).toBe("--addr");
			expect(args[1]).toBe("tcp://buildkitd-node.hanzo-build.svc:1234");
			expect(args).toContain("--tlscacert=/etc/buildkit-client-tls/ca.crt");
			expect(args).toContain("--tlscert=/etc/buildkit-client-tls/tls.crt");
			expect(args).toContain("--tlskey=/etc/buildkit-client-tls/tls.key");
			// Global flags must precede the verb or buildctl rejects them.
			expect(args.indexOf("build")).toBeGreaterThan(
				args.indexOf("--tlskey=/etc/buildkit-client-tls/tls.key"),
			);
		} finally {
			delete process.env.BUILDKITD_ADDR;
		}
	});

	it("stays single-GHCR (proven form) when no fleet registry is set", () => {
		const args = buildkitArgs({
			repo: "hanzoai/pricing",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/pricing:v1.2.3",
			buildJobId: "j1",
		});
		expect(args).toContain(
			"--output=type=image,name=ghcr.io/hanzoai/pricing:v1.2.3,push=true",
		);
		expect(args.some((a) => a.includes("registry.hanzo.ai"))).toBe(false);
	});

	it("emits ONE output with BOTH refs (quoted) when a fleet registry is set", () => {
		const args = buildkitArgs({
			repo: "hanzoai/pricing",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/pricing:v1.2.3",
			fleetRegistryHost: "registry.hanzo.ai",
			buildJobId: "j1",
		});
		// GHCR (public consumers) + the fleet registry (the estate deploys from
		// it), host-swapped from the GHCR ref, in ONE quoted name= field so the
		// CSV parser keeps the comma-joined refs as a single value. One build.
		expect(args).toContain(
			'--output=type=image,"name=ghcr.io/hanzoai/pricing:v1.2.3,registry.hanzo.ai/hanzoai/pricing:v1.2.3",push=true',
		);
		// Exactly one image output — never the bare single-ref form alongside it.
		expect(args.filter((a) => a.startsWith("--output=type=image")).length).toBe(
			1,
		);
		expect(args).not.toContain(
			"--output=type=image,name=ghcr.io/hanzoai/pricing:v1.2.3,push=true",
		);
	});
});

describe("per-org push credential", () => {
	// Registries never mix. The credential is DERIVED from the destination image
	// rather than configured, so there is no way to point a build at the wrong
	// org's token by hand. It also replaced a hardcoded `kaniko-ghcr`, which only
	// ever existed in the `hanzo` namespace and would not have mounted at all
	// once builds moved into `hanzo-build`.
	const secretOf = (image: string) => {
		const j = buildBuildkitJob({
			repo: "o/r",
			gitRef: "main",
			image,
			buildJobId: "j",
		});
		const vols = j.spec.template.spec.volumes as Vol[];
		return vols.find((v) => v.name === "docker-config")?.secret;
	};

	it("mounts push-<org> for each org, keyed to project .dockerconfigjson", () => {
		expect(secretOf("ghcr.io/hanzoai/pricing:v1")?.secretName).toBe(
			"push-hanzoai",
		);
		expect(secretOf("ghcr.io/luxfi/node:v1.36.35")?.secretName).toBe(
			"push-luxfi",
		);
		expect(secretOf("ghcr.io/zooai/app:v1")?.secretName).toBe("push-zooai");
		expect(secretOf("ghcr.io/hanzoai/pricing:v1")?.items).toEqual([
			{ key: ".dockerconfigjson", path: "config.json" },
		]);
	});

	it("mounts exactly ONE registry credential (no cross-org token in the pod)", () => {
		const j = buildBuildkitJob({
			repo: "luxfi/node",
			gitRef: "refs/tags/v1.36.35",
			image: "ghcr.io/luxfi/node:v1.36.35",
			buildJobId: "j",
		});
		const names = (j.spec.template.spec.volumes as Vol[])
			.map((v) => v.secret?.secretName)
			.filter((n): n is string => !!n && n.startsWith("push-"));
		expect(names).toEqual(["push-luxfi"]);
	});

	it("REFUSES an image with no derivable org rather than guessing one", () => {
		// A silent fallback here is how a build ends up pushing with another org's
		// token; the caller must see this immediately.
		expect(() =>
			buildBuildkitJob({
				repo: "o/r",
				gitRef: "main",
				image: "pricing:v1",
				buildJobId: "j",
			}),
		).toThrow(/Cannot derive a push credential/);
	});
});

describe("buildkitWrapperScript", () => {
	it("is the proven netrc→exec wrapper with no fleet registry", () => {
		const s = buildkitWrapperScript();
		expect(s).toContain("/tmp/netrc");
		// DEFAULT is the in-pod daemon. `buildctl` has no in-pod fallback, so
		// asserting it here — as this test used to — pins a contract under which
		// every build dies at dial the moment there is no reachable daemon.
		expect(s.endsWith('exec buildctl-daemonless.sh "$@"')).toBe(true);
		// No docker-cred merge when there is nothing to compose.
		expect(s).not.toContain("/tmp/fleet-cred");
	});

	it("execs the thin client instead once a daemon address is configured", () => {
		process.env.BUILDKITD_ADDR = "tcp://buildkitd-node.hanzo-build.svc:1234";
		try {
			expect(buildkitWrapperScript().endsWith('exec buildctl "$@"')).toBe(true);
			expect(buildkitWrapperScript("registry.hanzo.ai")).toContain(
				'exec buildctl "$@"',
			);
		} finally {
			delete process.env.BUILDKITD_ADDR;
		}
	});

	it("composes the two docker creds (jq-free) before exec when a fleet host is set", () => {
		const s = buildkitWrapperScript("registry.hanzo.ai");
		expect(s).toContain("/tmp/ghcr-cred/config.json");
		expect(s).toContain("/tmp/fleet-cred/config.json");
		// Peel each compact {"auths":{…}} and recombine into DOCKER_CONFIG.
		expect(s).toContain("printf '{\"auths\":{%s,%s}}'");
		expect(s).toContain("/root/.docker/config.json");
		// Missing/empty fleet cred degrades to GHCR-only — never fails the push.
		expect(s).toContain(
			"cp /tmp/ghcr-cred/config.json /root/.docker/config.json",
		);
		expect(s.endsWith('exec buildctl-daemonless.sh "$@"')).toBe(true);
	});
});

type EnvRef = {
	name: string;
	value?: string;
	valueFrom?: {
		secretKeyRef: { name: string; key: string; optional?: boolean };
	};
};

/**
 * The build namespace is the isolation boundary, and its DEFAULT is the whole
 * guarantee: `hanzo` is the application namespace holding ~700 tenant Secrets,
 * `hanzo-build` holds only build creds and denies ingress. A build executes a
 * Dockerfile we did not write, so defaulting to `hanzo` silently voids the
 * isolation — and it is also why the first self-service enqueue was refused 403
 * (platform-app has job-create in `hanzo-build` only). It regressed once as an
 * unasserted default; pin it so it cannot regress silently again.
 */
describe("buildNamespace", () => {
	const saved = process.env.PLATFORM_BUILD_NS;
	afterEach(() => {
		if (saved === undefined) delete process.env.PLATFORM_BUILD_NS;
		else process.env.PLATFORM_BUILD_NS = saved;
	});

	it("defaults to the isolated build namespace, NEVER the app namespace", () => {
		delete process.env.PLATFORM_BUILD_NS;
		expect(buildNamespace()).toBe("hanzo-build");
		expect(buildNamespace()).not.toBe("hanzo");
	});

	it("treats an unset/blank override as absent rather than as a namespace", () => {
		process.env.PLATFORM_BUILD_NS = "   ";
		expect(buildNamespace()).toBe("hanzo-build");
	});

	it("honours an explicit override", () => {
		process.env.PLATFORM_BUILD_NS = "hanzo-build-arm64";
		expect(buildNamespace()).toBe("hanzo-build-arm64");
	});

	it("lands the Job in the isolated namespace when no namespace is passed", () => {
		delete process.env.PLATFORM_BUILD_NS;
		const j = buildBuildkitJob({
			repo: "luxfi/node",
			gitRef: "refs/tags/v1.36.35",
			image: "ghcr.io/luxfi/node:v1.36.35",
			buildJobId: "nsdefault1",
		});
		expect(j.metadata.namespace).toBe("hanzo-build");
	});
});

describe("buildBuildkitJob", () => {
	const job = buildBuildkitJob({
		repo: "hanzoai/pricing",
		gitRef: "refs/heads/main",
		image: "ghcr.io/hanzoai/pricing:t",
		buildJobId: "abc12345",
	});
	const pod = job.spec.template.spec;
	const container = pod.containers[0]!;

	// DEFAULT PATH — an in-pod daemon, exactly what runs today. The previous
	// version of this test asserted the opposite on every line (`buildctl`, no
	// daemonless, unprivileged, no nodeSelector) and it was pinning a contract
	// under which every build fails: `buildctl` has no in-pod fallback, so with
	// no reachable daemon it dies at dial rather than building the slow way.
	it("builds in-pod, privileged, on the CI pool when no daemon is configured", () => {
		expect(container.image).toBe("moby/buildkit:v0.16.0");
		expect(container.command).toEqual(["/bin/sh", "-c"]);
		expect(container.args[1]).toBe("buildctl-daemonless.sh");
		expect(container.args[0]!).toContain('exec buildctl-daemonless.sh "$@"');
		expect(container.securityContext.privileged).toBe(true);
		// It MUST land on the CI pool: that is where builds have always run, and
		// the general pools are 4vCPU/6Gi and full.
		expect(pod.nodeSelector).toEqual({
			"doks.digitalocean.com/node-pool": "runner-pool-32g",
		});
		expect(pod.tolerations[0]!.value).toBe("ci-runner");
		// No trust-domain label and no client certificate: it dials nothing, so
		// handing it reachability or a credential would be surface with no use.
		expect(
			job.spec.template.metadata.labels["hanzo.ai/build-trust-domain"],
		).toBeUndefined();
		expect(
			(pod.volumes as Vol[]).some((v) => v.name === "buildkitd-client-tls"),
		).toBe(false);
	});

	// REMOTE PATH — everything the client needs to actually reach a daemon, and
	// each item is a separate way the first cut of this change would have failed:
	//  - nodeSelector carries the TRUST DOMAIN, because the daemon exists only on
	//    its own domain's nodes and `internalTrafficPolicy: Local` drops traffic
	//    on a node with no local endpoint. A client elsewhere reaches nothing.
	//  - the pod LABEL, because the daemon's NetworkPolicy admits :1234 from
	//    pods carrying it and nothing else.
	//  - the client certificate volume, because the daemon demands one.
	it("carries domain, label and certificate when a daemon IS configured", () => {
		process.env.BUILDKITD_ADDR = "tcp://buildkitd-node.hanzo-build.svc:1234";
		try {
			const j = buildBuildkitJob({
				repo: "hanzoai/pricing",
				gitRef: "refs/heads/main",
				image: "ghcr.io/hanzoai/pricing:t",
				buildJobId: "abc12345",
			});
			const p = j.spec.template.spec;
			const c = p.containers[0]!;
			expect(c.args[1]).toBe("buildctl");
			expect(c.args[0]!).not.toContain("daemonless");
			expect(c.securityContext.privileged).toBeUndefined();
			expect(c.securityContext.allowPrivilegeEscalation).toBe(false);
			expect(p.nodeSelector).toEqual({
				"doks.digitalocean.com/node-pool": "runner-pool-32g",
				"build-trust-domain": "hanzoai",
			});
			expect(
				j.spec.template.metadata.labels["hanzo.ai/build-trust-domain"],
			).toBe("hanzoai");
			const tls = (p.volumes as Vol[]).find(
				(v) => v.name === "buildkitd-client-tls",
			);
			expect(tls?.secret?.secretName).toBe("buildkitd-client-tls");
			expect(
				(c.volumeMounts as Mount[]).find(
					(m) => m.name === "buildkitd-client-tls",
				)?.mountPath,
			).toBe("/etc/buildkit-client-tls");
		} finally {
			delete process.env.BUILDKITD_ADDR;
		}
	});

	it("wires git + registry auth from the canonical secrets", () => {
		const gitEnv = (container.env as EnvRef[]).find(
			(e) => e.name === "GIT_AUTH_TOKEN",
		);
		expect(gitEnv?.valueFrom?.secretKeyRef.name).toBe("console-git-token");
		// No fleet registry → the proven single-secret mount, unchanged.
		expect((pod.volumes as Vol[])[0]!.secret?.secretName).toBe("push-hanzoai");
		expect((container.volumeMounts as Mount[])[0]!.mountPath).toBe(
			"/root/.docker",
		);
		expect(pod.volumes.length).toBe(1);
	});

	it("does not mount a service account token into the build pod", () => {
		expect(pod.automountServiceAccountToken).toBe(false);
	});

	it("labels the Job with its build-job id for correlation", () => {
		expect(job.metadata.labels["hanzo.ai/build-job-id"]).toBe("abc12345");
		expect(job.metadata.name).toBe("build-pricing-abc12345");
	});
});

describe("buildBuildkitJob — fleet dual-push wiring", () => {
	const job = buildBuildkitJob({
		repo: "hanzoai/pricing",
		gitRef: "refs/heads/main",
		image: "ghcr.io/hanzoai/pricing:t",
		fleetRegistryHost: "registry.hanzo.ai",
		buildJobId: "abc12345",
	});
	const pod = job.spec.template.spec;
	const container = pod.containers[0]!;
	const vols = Object.fromEntries(
		(pod.volumes as Vol[]).map((v) => [v.name, v]),
	);
	const mounts = Object.fromEntries(
		(container.volumeMounts as Mount[]).map((m) => [m.name, m.mountPath]),
	);

	it("mounts BOTH the GHCR and the KMS-synced fleet cred", () => {
		expect(vols["ghcr-cred"]!.secret?.secretName).toBe("push-hanzoai");
		expect(vols["fleet-cred"]!.secret?.secretName).toBe("registry-credentials");
		expect(vols["fleet-cred"]!.secret?.items[0]!.key).toBe(".dockerconfigjson");
		expect(mounts["ghcr-cred"]).toBe("/tmp/ghcr-cred");
		expect(mounts["fleet-cred"]).toBe("/tmp/fleet-cred");
	});

	it("makes DOCKER_CONFIG a writable emptyDir the wrapper composes into", () => {
		expect(vols["docker-config"]!.emptyDir).toBeDefined();
		expect(vols["docker-config"]!.secret).toBeUndefined();
		expect(mounts["docker-config"]).toBe("/root/.docker");
		expect(container.args[0]!).toContain("printf '{\"auths\":{%s,%s}}'");
	});

	it("NEVER duplicates the fleet cred into the push secret (one canonical home)", () => {
		// registry-credentials stays the sole home for the fleet cred; the per-org
		// push secret carries only the GHCR cred — same DRY split the ci reusable
		// uses. The push secrets store it under `.dockerconfigjson` and project it
		// to the `config.json` filename BuildKit reads.
		expect(vols["ghcr-cred"]!.secret?.items[0]!.key).toBe(".dockerconfigjson");
		expect(vols["ghcr-cred"]!.secret?.items[0]!.path).toBe("config.json");
		const fleetInGhcr = JSON.stringify(vols["ghcr-cred"]).includes(
			"registry-credentials",
		);
		expect(fleetInGhcr).toBe(false);
	});
});

/**
 * parseImageDigest turns a build's log into the one fact the build row could
 * never state: WHICH BYTES it produced. The traps are all near-misses — a
 * BuildKit export prints a config digest and a digest per layer right next to
 * the manifest digest, and picking the wrong one yields a confident wrong
 * answer that is worse than NULL, because drift detection would compare
 * against it and flag every deploy forever.
 */
const MANIFEST = `sha256:${"1".repeat(64)}`;
const CONFIG = `sha256:${"2".repeat(64)}`;
const LAYER = `sha256:${"3".repeat(64)}`;

describe("parseImageDigest", () => {
	it("takes the pushed MANIFEST digest, never the config or a layer", () => {
		const log = [
			"#15 exporting to image",
			`#15 exporting layers ${LAYER} 2.3s done`,
			`#15 exporting manifest ${MANIFEST} done`,
			`#15 exporting config ${CONFIG} done`,
			`#15 pushing manifest for ghcr.io/hanzoai/app:v1.2.3@${MANIFEST}`,
			"#15 DONE 6.2s",
		].join("\n");
		expect(parseImageDigest(log)).toBe(MANIFEST);
	});

	it("returns ONE digest for a dual-push, where two refs carry one manifest", () => {
		// FLEET_REGISTRY_HOST makes the single build push the same manifest to
		// GHCR and registry.hanzo.ai — two lines, one truth.
		const log = [
			`#15 pushing manifest for ghcr.io/hanzoai/app:v1.2.3@${MANIFEST}`,
			`#15 pushing manifest for registry.hanzo.ai/hanzoai/app:v1.2.3@${MANIFEST}`,
		].join("\n");
		expect(parseImageDigest(log)).toBe(MANIFEST);
	});

	it("falls back to the exported manifest when the log has no push line", () => {
		expect(parseImageDigest(`#15 exporting manifest ${MANIFEST} done`)).toBe(
			MANIFEST,
		);
	});

	it("reads a multi-arch `exporting manifest list`", () => {
		expect(
			parseImageDigest(`#15 exporting manifest list ${MANIFEST} done`),
		).toBe(MANIFEST);
	});

	it("is undefined when nothing was pushed or exported", () => {
		const log = [
			"#8 [builder 3/5] RUN go build ./...",
			`#9 sha256:${"f".repeat(64)}`, // bare digest — a layer ref, not a manifest
			"#15 DONE 6.2s",
		].join("\n");
		expect(parseImageDigest(log)).toBeUndefined();
	});

	it("is undefined for an empty log rather than throwing", () => {
		expect(parseImageDigest("")).toBeUndefined();
	});

	it("ignores a config digest even when it is the only sha256 present", () => {
		expect(
			parseImageDigest(`#15 exporting config ${CONFIG} done`),
		).toBeUndefined();
	});
});
