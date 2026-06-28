import {
	buildBuildkitJob,
	buildJobName,
	buildkitArgs,
} from "@hanzo/platform/services/ci/buildkit-job";
import { describe, expect, it } from "vitest";

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
});

type EnvRef = {
	name: string;
	value?: string;
	valueFrom?: { secretKeyRef: { name: string; key: string; optional?: boolean } };
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
		expect(container.command).toEqual(["buildctl-daemonless.sh"]);
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
		expect(pod.volumes[0]!.secret.secretName).toBe("kaniko-ghcr");
		expect(container.volumeMounts[0]!.mountPath).toBe("/root/.docker");
	});

	it("does not mount a service account token into the build pod", () => {
		expect(pod.automountServiceAccountToken).toBe(false);
	});

	it("labels the Job with its build-job id for correlation", () => {
		expect(job.metadata.labels["hanzo.ai/build-job-id"]).toBe("abc12345");
		expect(job.metadata.name).toBe("build-pricing-abc12345");
	});
});
