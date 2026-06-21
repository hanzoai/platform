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
		expect(cfg.builds).toHaveLength(1);
		expect(cfg.builds[0]!.matrix).toHaveLength(2);
		expect(cfg.builds[0]!.image).toBe("ghcr.io/hanzoai/zip");
		expect(cfg.builds[0]!.push).toBe(true);
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
		expect(cfg.builds[0]!.dockerfile).toBe("./Dockerfile");
		expect(cfg.builds[0]!.context).toBe(".");
		expect(cfg.builds[0]!.tagPattern).toBe("{{git.sha}}");
		expect(cfg.builds[0]!.push).toBe(true);
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

const MULTI_IMAGE = `
images:
  - { name: api, context: ./api, repo: ghcr.io/bootnode/bootnode, tag-suffix: api }
  - { name: web, context: ./web, repo: ghcr.io/bootnode/bootnode, tag-suffix: web }
test:
  - { name: api, run: "pytest -q" }
kms: { path: /deploy, environment: prod }
`;

describe("images (hanzo.yml multi-image)", () => {
	it("parses a list of images into builds", () => {
		const cfg = parsePlatformConfig(MULTI_IMAGE);
		expect(cfg.builds).toHaveLength(2);
		expect(cfg.builds[0]!.name).toBe("api");
		expect(cfg.builds[0]!.image).toBe("ghcr.io/bootnode/bootnode");
		expect(cfg.builds[0]!.context).toBe("./api");
		expect(cfg.builds[0]!.dockerfile).toBe("./api/Dockerfile");
		expect(cfg.builds[0]!.tagPattern).toBe("{{git.sha}}-amd64-api");
		expect(cfg.builds[1]!.name).toBe("web");
		// default matrix is linux/amd64
		expect(cfg.builds[0]!.matrix).toEqual([{ os: "linux", arch: "amd64" }]);
		// `test`/`kms` keys are ignored by the platform; deploy via cicd/universe
		expect(cfg.deploy).toBeUndefined();
	});
	it("rejects an empty images list", () => {
		expect(() => validatePlatformConfig({ images: [] })).toThrow(/non-empty/);
	});
	it("rejects a tag in images[].repo", () => {
		expect(() =>
			validatePlatformConfig({ images: [{ name: "a", repo: "x/y:v1" }] }),
		).toThrow(/bare repository/);
	});
	it("rejects duplicate image names", () => {
		expect(() =>
			validatePlatformConfig({
				images: [
					{ name: "api", repo: "x/y" },
					{ name: "api", repo: "x/z" },
				],
			}),
		).toThrow(/duplicate image name/);
	});
	it("treats a Deployment-style deploy (services) as build-only", () => {
		const cfg = validatePlatformConfig({
			images: [{ name: "api", repo: "x/y" }],
			deploy: { on: ["main"], cluster: "c", namespace: "n", services: [] },
		});
		expect(cfg.builds).toHaveLength(1);
		expect(cfg.deploy).toBeUndefined();
	});
});

describe("build.dispatch", () => {
	it("defaults to native when omitted", () => {
		const cfg = parsePlatformConfig(VALID);
		expect(cfg.builds[0]!.dispatch).toBe("native");
	});
	it("accepts an explicit workflow_dispatch", () => {
		const cfg = parsePlatformConfig(
			VALID.replace("push: true", "push: true\n  dispatch: workflow_dispatch"),
		);
		expect(cfg.builds[0]!.dispatch).toBe("workflow_dispatch");
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
