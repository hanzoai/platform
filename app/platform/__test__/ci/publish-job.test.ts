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
	cargo: false,
	cargoCrates: [],
	packageDir: ".",
	dryRun: false,
	...over,
});

describe("publishScript", () => {
	it("clones from the forge", () => {
		const s = publishScript(cfg({ npm: true }));
		expect(s).toContain(
			'"https://x-access-token:${GIT_AUTH_TOKEN}@git.hanzo.ai/${REPO}.git" src',
		);
		expect(s).not.toContain("github.com");
	});

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

	it("publishes a single crate to crates.io with the registry token", () => {
		const s = publishScript(cfg({ cargo: true }));
		expect(s).toContain("sh.rustup.rs");
		expect(s).toContain('cargo publish --no-verify --token "${CARGO_REGISTRY_TOKEN:-}"');
		expect(s).toContain("for c in .; do");
		expect(s).not.toContain("--dry-run");
	});

	it("publishes a cargo workspace bottom-up in the declared crate order", () => {
		const s = publishScript(
			cfg({ cargo: true, cargoCrates: ["hanzo-kernels", "hanzo-ml", "hanzo-nn"] }),
		);
		expect(s).toContain("for c in hanzo-kernels hanzo-ml hanzo-nn; do");
	});

	it("treats an already-published crate as a skip, not a failure", () => {
		const s = publishScript(cfg({ cargo: true }));
		expect(s).toContain("already (uploaded|exists)|is already uploaded");
	});

	it("dry-runs cargo without uploading", () => {
		const s = publishScript(cfg({ cargo: true, dryRun: true }));
		expect(s).toContain("cargo publish --no-verify --dry-run");
		expect(s).not.toContain('--token "${CARGO_REGISTRY_TOKEN');
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
		const cargo = env.find((e) => e.name === "CARGO_REGISTRY_TOKEN");
		expect(npm?.valueFrom?.secretKeyRef.name).toBe("npm-token");
		expect(npm?.valueFrom?.secretKeyRef.optional).toBe(true);
		expect(pypi?.valueFrom?.secretKeyRef.name).toBe("pypi-token");
		expect(cargo?.valueFrom?.secretKeyRef.name).toBe("cargo-token");
		expect(cargo?.valueFrom?.secretKeyRef.optional).toBe(true);
		// no plaintext token value anywhere in the spec
		expect(JSON.stringify(job)).not.toMatch(/_authToken=[A-Za-z0-9]/);
	});

	it("clones via the git token secret", () => {
		const git = env.find((e) => e.name === "GIT_AUTH_TOKEN");
		expect(git?.valueFrom?.secretKeyRef.name).toBe("git-hanzo-ai-token");
	});
});
