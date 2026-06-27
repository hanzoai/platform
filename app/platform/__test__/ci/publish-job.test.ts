import {
	buildPublishJobObject,
	publishJobName,
	publishScript,
} from "@hanzo/platform/services/ci/publish-job";
import type { PublishConfig } from "@hanzo/platform/services/ci/platform-config";
import { describe, expect, it } from "vitest";

const cfg = (over: Partial<PublishConfig> = {}): PublishConfig => ({
	npm: false,
	pypi: false,
	packageDir: ".",
	dryRun: false,
	...over,
});

describe("publishScript", () => {
	it("publishes to npm with the registry token", () => {
		const s = publishScript(cfg({ npm: true }));
		expect(s).toContain("set -euo pipefail");
		expect(s).toContain('_authToken=${NPM_TOKEN:-}');
		expect(s).toContain("npm publish --access public");
		expect(s).not.toContain("--dry-run");
		expect(s).not.toContain("uv build");
	});

	it("dry-runs npm without uploading", () => {
		const s = publishScript(cfg({ npm: true, dryRun: true }));
		expect(s).toContain("npm publish --access public --dry-run");
	});

	it("builds + publishes to pypi via uv", () => {
		const s = publishScript(cfg({ pypi: true }));
		expect(s).toContain("uv build");
		expect(s).toContain('uv publish --token "${PYPI_TOKEN:-}"');
	});

	it("dry-runs pypi with twine check, no upload", () => {
		const s = publishScript(cfg({ pypi: true, dryRun: true }));
		expect(s).toContain("uv build");
		expect(s).toContain("uvx twine check dist/*");
		expect(s).not.toContain("uv publish");
	});

	it("supports both targets in one Job", () => {
		const s = publishScript(cfg({ npm: true, pypi: true }));
		expect(s).toContain("npm publish");
		expect(s).toContain("uv build");
	});
});

describe("publishJobName", () => {
	it("is RFC1123-safe and prefixed", () => {
		const n = publishJobName("hanzoai/iam-js-sdk", "ID_99");
		expect(n).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
		expect(n.startsWith("publish-iam-js-sdk-")).toBe(true);
	});
});

type EnvRef = {
	name: string;
	value?: string;
	valueFrom?: { secretKeyRef: { name: string; key: string; optional?: boolean } };
};

describe("buildPublishJobObject", () => {
	const job = buildPublishJobObject({
		repo: "hanzoai/iam-js-sdk",
		branch: "main",
		publish: cfg({ npm: true }),
		buildJobId: "abc12345",
	});
	const env = job.spec.template.spec.containers[0]!.env as EnvRef[];

	it("mounts registry tokens as OPTIONAL KMS-synced secrets (never hardcoded)", () => {
		const npm = env.find((e) => e.name === "NPM_TOKEN");
		const pypi = env.find((e) => e.name === "PYPI_TOKEN");
		expect(npm?.valueFrom?.secretKeyRef.name).toBe("npm-token");
		expect(npm?.valueFrom?.secretKeyRef.optional).toBe(true);
		expect(pypi?.valueFrom?.secretKeyRef.name).toBe("pypi-token");
		// no plaintext token value anywhere in the spec
		expect(JSON.stringify(job)).not.toMatch(/_authToken=[A-Za-z0-9]/);
	});

	it("clones via the git token secret", () => {
		const git = env.find((e) => e.name === "GIT_AUTH_TOKEN");
		expect(git?.valueFrom?.secretKeyRef.name).toBe("console-git-token");
	});
});
