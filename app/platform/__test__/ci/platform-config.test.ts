import {
	PlatformConfigError,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
	validatePlatformConfig,
} from "@hanzo/platform/services/ci/platform-config";
import { describe, expect, it } from "vitest";

const VALID = `
build:
  matrix:
    - { os: linux, arch: amd64 }
    - { os: linux, arch: arm64 }
  dockerfile: ./Dockerfile
  context: .
  image: ghcr.io/hanzoai/zip
  tag-pattern: "{{git.sha}}"
  push: true
deploy:
  on:
    - main
  target:
    cluster: hanzo-k8s
    namespace: hanzo
    operator: hanzo-operator
    crd: Service
    name: zip
`;

describe("parsePlatformConfig", () => {
	it("parses a full valid config", () => {
		const cfg = parsePlatformConfig(VALID);
		expect(cfg.build.matrix).toHaveLength(2);
		expect(cfg.build.image).toBe("ghcr.io/hanzoai/zip");
		expect(cfg.build.push).toBe(true);
		expect(cfg.deploy?.target.name).toBe("zip");
		expect(cfg.deploy?.target.crd).toBe("Service");
	});

	it("applies defaults for optional build fields", () => {
		const cfg = parsePlatformConfig(`
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/hanzoai/base
`);
		expect(cfg.build.dockerfile).toBe("./Dockerfile");
		expect(cfg.build.context).toBe(".");
		expect(cfg.build.tagPattern).toBe("{{git.sha}}");
		expect(cfg.build.push).toBe(true);
		expect(cfg.deploy).toBeUndefined();
	});

	it("rejects a missing build block", () => {
		expect(() => parsePlatformConfig("deploy: {}")).toThrow(
			PlatformConfigError,
		);
	});

	it("rejects an empty matrix", () => {
		expect(() =>
			validatePlatformConfig({ build: { matrix: [], image: "x/y" } }),
		).toThrow(/non-empty list/);
	});

	it("rejects an invalid os", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "plan9", arch: "amd64" }], image: "x/y" },
			}),
		).toThrow(/os must be one of/);
	});

	it("rejects an invalid arch", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "linux", arch: "riscv" }], image: "x/y" },
			}),
		).toThrow(/arch must be one of/);
	});

	it("rejects a tag on the image", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y:v1" },
			}),
		).toThrow(/bare repository/);
	});

	it("rejects duplicate matrix entries", () => {
		expect(() =>
			validatePlatformConfig({
				build: {
					matrix: [
						{ os: "linux", arch: "amd64" },
						{ os: "linux", arch: "amd64" },
					],
					image: "x/y",
				},
			}),
		).toThrow(/duplicate target/);
	});

	it("rejects an unsupported operator", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
				deploy: {
					on: ["main"],
					target: {
						cluster: "c",
						namespace: "n",
						operator: "argocd",
						crd: "Service",
						name: "x",
					},
				},
			}),
		).toThrow(/operator must be one of/);
	});

	it("rejects legacy HanzoService CRD", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
				deploy: {
					on: ["main"],
					target: {
						cluster: "c",
						namespace: "n",
						operator: "hanzo-operator",
						crd: "HanzoService",
						name: "x",
					},
				},
			}),
		).toThrow(/one way only/);
	});

	it("rejects non-YAML", () => {
		expect(() => parsePlatformConfig(":\n  - [")).toThrow(PlatformConfigError);
	});
});

describe("build.dispatch", () => {
	it("defaults to native when omitted", () => {
		const cfg = parsePlatformConfig(VALID);
		expect(cfg.build.dispatch).toBe("native");
	});
	it("accepts an explicit workflow_dispatch", () => {
		const cfg = parsePlatformConfig(
			VALID.replace("push: true", "push: true\n  dispatch: workflow_dispatch"),
		);
		expect(cfg.build.dispatch).toBe("workflow_dispatch");
	});
	it("rejects an unknown dispatch mode", () => {
		expect(() =>
			parsePlatformConfig(
				VALID.replace("push: true", "push: true\n  dispatch: carrier-pigeon"),
			),
		).toThrow(PlatformConfigError);
	});
});

describe("runnerPoolFor", () => {
	it("maps hanzoai/linux/amd64 to the real ARC pool hanzo-build-linux-amd64", () => {
		expect(runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" })).toBe(
			"hanzo-build-linux-amd64",
		);
	});
	it("maps org login to brand prefix (luxfi→lux, zooai→zoo)", () => {
		expect(runnerPoolFor("luxfi", { os: "linux", arch: "amd64" })).toBe(
			"lux-build-linux-amd64",
		);
		expect(runnerPoolFor("zooai", { os: "linux", arch: "amd64" })).toBe(
			"zoo-build-linux-amd64",
		);
	});
	it("defaults an unmapped org to its own login as brand", () => {
		expect(runnerPoolFor("hanzobot", { os: "linux", arch: "amd64" })).toBe(
			"hanzobot-build-linux-amd64",
		);
	});
	it("maps darwin to macos", () => {
		expect(runnerPoolFor("hanzoai", { os: "darwin", arch: "arm64" })).toBe(
			"hanzo-build-macos-arm64",
		);
	});
	it("honors an explicit deploy role", () => {
		expect(
			runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" }, "deploy"),
		).toBe("hanzo-deploy-linux-amd64");
	});
});

describe("resolveTag", () => {
	it("substitutes git.sha", () => {
		expect(resolveTag("{{git.sha}}", { sha: "abc123", branch: "main" })).toBe(
			"abc123",
		);
	});
	it("sanitizes branch in tag", () => {
		expect(
			resolveTag("br-{{git.branch}}", { sha: "x", branch: "feat/foo bar" }),
		).toBe("br-feat-foo-bar");
	});
});
