import {
	buildJobName,
	buildKanikoJob,
	kanikoArgs,
} from "@hanzo/platform/services/ci/kaniko-job";
import { describe, expect, it } from "vitest";

/**
 * kaniko-job is the single build muscle. These tests pin the Kaniko Job
 * contract (git context, destination, digest file, auth secrets, runner pool)
 * that the hand-applied build Jobs proved — so bridging the scheduler to it
 * produces the SAME build a human would have applied by hand.
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

describe("kanikoArgs", () => {
	it("emits the proven git-context build contract", () => {
		const args = kanikoArgs({
			repo: "hanzoai/pricing",
			gitRef: "refs/heads/main",
			image: "ghcr.io/hanzoai/pricing:v1.2.3",
			buildJobId: "j1",
		});
		expect(args).toContain(
			"--context=git://github.com/hanzoai/pricing.git#refs/heads/main",
		);
		expect(args).toContain("--destination=ghcr.io/hanzoai/pricing:v1.2.3");
		expect(args).toContain("--dockerfile=Dockerfile");
		expect(args).toContain("--digest-file=/dev/termination-log");
		expect(args).toContain("--custom-platform=linux/amd64");
		// no sub-path or target for a root-context, single-stage build
		expect(args.some((a) => a.startsWith("--context-sub-path"))).toBe(false);
		expect(args.some((a) => a.startsWith("--target="))).toBe(false);
	});

	it("strips a leading ./ from the dockerfile", () => {
		const args = kanikoArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			dockerfile: "./Dockerfile.production",
			buildJobId: "j",
		});
		expect(args).toContain("--dockerfile=Dockerfile.production");
	});

	it("adds --context-sub-path and --target when set", () => {
		const args = kanikoArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			context: "services/api",
			dockerTarget: "runtime",
			buildJobId: "j",
		});
		expect(args).toContain("--context-sub-path=services/api");
		expect(args).toContain("--target=runtime");
	});

	it("targets arm64 platform when arch=arm64", () => {
		const args = kanikoArgs({
			repo: "o/r",
			gitRef: "main",
			image: "i:t",
			arch: "arm64",
			buildJobId: "j",
		});
		expect(args).toContain("--custom-platform=linux/arm64");
	});
});

type EnvRef = {
	name: string;
	value?: string;
	valueFrom?: { secretKeyRef: { name: string; key: string; optional?: boolean } };
};

describe("buildKanikoJob", () => {
	const job = buildKanikoJob({
		repo: "hanzoai/pricing",
		gitRef: "refs/heads/main",
		image: "ghcr.io/hanzoai/pricing:t",
		buildJobId: "abc12345",
	});
	const pod = job.spec.template.spec;
	const container = pod.containers[0]!;

	it("uses the kaniko executor and CI runner pool", () => {
		expect(container.image).toBe("gcr.io/kaniko-project/executor:latest");
		expect(pod.nodeSelector["doks.digitalocean.com/node-pool"]).toBe(
			"runner-pool-32g",
		);
		expect(pod.tolerations[0]!.value).toBe("ci-runner");
	});

	it("wires git + registry auth from the canonical secrets", () => {
		const gitEnv = (container.env as EnvRef[]).find(
			(e) => e.name === "GIT_PASSWORD",
		);
		expect(gitEnv?.valueFrom?.secretKeyRef.name).toBe("console-git-token");
		expect(pod.volumes[0]!.secret.secretName).toBe("kaniko-ghcr");
		expect(container.volumeMounts[0]!.mountPath).toBe("/kaniko/.docker");
	});

	it("does not mount a service account token into the build pod", () => {
		expect(pod.automountServiceAccountToken).toBe(false);
	});

	it("labels the Job with its build-job id for correlation", () => {
		expect(job.metadata.labels["hanzo.ai/build-job-id"]).toBe("abc12345");
		expect(job.metadata.name).toBe("build-pricing-abc12345");
	});
});
