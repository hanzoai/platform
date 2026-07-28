import {
	buildBuildkitJob,
	buildJobName,
	buildkitArgs,
	buildkitWrapperScript,
} from "@hanzo/platform/services/ci/buildkit-job";
import { describe, expect, it } from "vitest";

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
		expect(args[0]).toBe("build");
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
		expect(emitted).toEqual(["--opt=build-arg:BUILDKIT_CONTEXT_KEEP_GIT_DIR=0"]);
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

	it("targets the arm64 platform when arch=arm64", () => {
		const args = buildkitArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			arch: "arm64",
			buildJobId: "j",
		});
		expect(args).toContain("--opt=platform=linux/arm64");
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

describe("buildkitWrapperScript", () => {
	it("is the proven netrc→exec wrapper with no fleet registry", () => {
		const s = buildkitWrapperScript();
		expect(s).toContain("/tmp/netrc");
		expect(s.endsWith('exec buildctl-daemonless.sh "$@"')).toBe(true);
		// No docker-cred merge when there is nothing to compose.
		expect(s).not.toContain("/tmp/fleet-cred");
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

describe("buildBuildkitJob", () => {
	const job = buildBuildkitJob({
		repo: "hanzoai/pricing",
		gitRef: "refs/heads/main",
		image: "ghcr.io/hanzoai/pricing:t",
		buildJobId: "abc12345",
	});
	const pod = job.spec.template.spec;
	const container = pod.containers[0]!;

	it("runs the privileged BuildKit executor on the CI runner pool", () => {
		expect(container.image).toBe("moby/buildkit:v0.16.0");
		// buildctl runs under an `sh -c` wrapper (materializes ~/.netrc); its real
		// args ride "$@" after the `buildctl-daemonless.sh` $0 placeholder.
		expect(container.command).toEqual(["/bin/sh", "-c"]);
		expect(container.args[1]).toBe("buildctl-daemonless.sh");
		expect(container.args[0]!).toContain('exec buildctl-daemonless.sh "$@"');
		expect(container.securityContext.privileged).toBe(true);
		expect(pod.nodeSelector["doks.digitalocean.com/node-pool"]).toBe(
			"runner-pool-32g",
		);
		expect(pod.tolerations[0]!.value).toBe("ci-runner");
	});

	it("wires git + registry auth from the canonical secrets", () => {
		const gitEnv = (container.env as EnvRef[]).find(
			(e) => e.name === "GIT_AUTH_TOKEN",
		);
		expect(gitEnv?.valueFrom?.secretKeyRef.name).toBe("console-git-token");
		// No fleet registry → the proven single-secret mount, unchanged.
		expect((pod.volumes as Vol[])[0]!.secret?.secretName).toBe("kaniko-ghcr");
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
		expect(vols["ghcr-cred"]!.secret?.secretName).toBe("kaniko-ghcr");
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

	it("NEVER duplicates the fleet cred into kaniko-ghcr (one canonical home)", () => {
		// registry-credentials stays the sole home for the fleet cred; kaniko-ghcr
		// carries only the GHCR config.json — same DRY split the ci reusable uses.
		expect(vols["ghcr-cred"]!.secret?.items[0]!.key).toBe("config.json");
		const fleetInGhcr = JSON.stringify(vols["ghcr-cred"]).includes(
			"registry-credentials",
		);
		expect(fleetInGhcr).toBe(false);
	});
});
