/**
 * `.platform.yml` — repo-declared build + deploy intent.
 *
 * Each repo that opts into platform-native CI/CD commits a `.platform.yml`
 * at its root. Platform reads it on every webhook to decide what to build,
 * where to push the image, and (optionally) what to roll out and where.
 *
 * This module is the single source of truth for that schema. It provides:
 *   - the TypeScript shape (`PlatformConfig`)
 *   - an in-house structural validator (`validatePlatformConfig`) that
 *     returns precise, path-qualified errors — no heavyweight JSON-Schema dep
 *   - a YAML parser (`parsePlatformConfig`) using the already-vendored `yaml`
 *
 * The validator is intentionally hand-rolled and total: every reachable
 * invalid input yields a real error string, never a thrown stack or a
 * silently-accepted bad config.
 */
import { parse as parseYaml } from "yaml";
// Deployable kinds come from the operator contract — one source of truth.
// `cr-builder` is a pure module (types + builders, no K8s client), so importing
// it here does not drag a cluster connection into config parsing.
import { tagOf } from "../hanzo-git";
import {
	DEFAULT_WORKLOAD_KIND,
	WORKLOAD_KINDS,
} from "../k8s/operator/cr-builder";

export type BuildOS = "linux" | "darwin" | "windows";
export type BuildArch = "amd64" | "arm64";

export interface MatrixEntry {
	os: BuildOS;
	arch: BuildArch;
}

export interface BuildConfig {
	/** Image name (multi-image `images:` form); empty for the legacy `build:` form. */
	name: string;
	matrix: MatrixEntry[];
	dockerfile: string;
	context: string;
	image: string;
	/**
	 * Tag template. Two tokens: `{{git.sha}}` and `{{git.tag}}` (tag pushes only
	 * — see {@link resolveTag}).
	 */
	tagPattern: string;
	push: boolean;
	/**
	 * Per-image `--build-arg` pairs, declared as `args:` on the image entry.
	 *
	 * A Dockerfile that ends in `FROM ${STAGE} AS final` selects what it ships
	 * from one of these, so dropping them does not fail — it silently builds the
	 * ARG default and tags it as something else.
	 */
	buildArgs: Record<string, string>;
	/**
	 * Publishable build-time secret NAMES (`build_secrets:` on the image entry).
	 * Each is fetched from KMS at schedule time and merged into buildArgs as
	 * `--build-arg NAME=<value>`. Only the ci-reusable and the explicit /v1/runner
	 * buildArgs path used to pass these; the webhook lane did not, so a repo
	 * declaring one built with an empty value and its Dockerfile refused.
	 */
	buildSecrets: string[];
}

/** A Dockerfile ARG name. Anything else is not one. */
const ARG_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Read a flat string map of build args off untrusted input.
 *
 * Returns the message when the value is not that, else null. A value rides as
 * its own argv element and never through a shell, but a KEY is spliced into
 * `--opt=build-arg:<key>=<value>`, so a key that is not an ARG name would build
 * a different option than it reads like. Control characters are refused for the
 * same reason: one arg must stay one arg.
 *
 * Shared so the YAML lane and the request-body lane cannot disagree about what
 * a build arg is.
 */
export function buildArgsProblem(value: unknown): string | null {
	if (value === undefined) return null;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "buildArgs must be an object of string values";
	}
	const entries = Object.entries(value);
	if (entries.length > 64) return "buildArgs may declare at most 64 keys";
	for (const [k, v] of entries) {
		if (!ARG_NAME.test(k)) {
			return `buildArgs key "${k}" is not a valid Dockerfile ARG name`;
		}
		if (typeof v !== "string") {
			return `buildArgs value for "${k}" must be a string`;
		}
		if (v.length > 1024) {
			return `buildArgs value for "${k}" exceeds 1024 bytes`;
		}
		if (/[\0\n\r]/.test(v)) {
			return `buildArgs value for "${k}" contains a control character`;
		}
	}
	return null;
}

/**
 * Validate and normalize an `args:` map.
 *
 * Keys are sorted so one commit yields one argv and therefore one cache key —
 * an image whose build args differ only in order is the same image, and should
 * not miss the cache saying so.
 */
function parseBuildArgs(value: unknown, at: string): Record<string, string> {
	const problem = buildArgsProblem(value);
	if (problem) throw new PlatformConfigError(`${at}: ${problem}`);
	if (value === undefined) return {};
	const out: Record<string, string> = {};
	// Entries, not keys-then-index: under `noUncheckedIndexedAccess` a lookup
	// yields `string | undefined` even for a key that came from Object.keys, so
	// the indexed form needed a non-null assertion to compile. Iterating entries
	// carries the value with its key and needs none.
	//
	// `a < b` is UTF-16 code-unit order, which is exactly what a bare
	// `Array.prototype.sort()` on strings does — so the sort this function exists
	// for is unchanged. (`localeCompare` would NOT be equivalent.)
	const entries = Object.entries(value as Record<string, string>);
	entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	for (const [k, v] of entries) out[k] = v;
	return out;
}

/**
 * A build_secret name must be PUBLISHABLE: it is baked into the image as a
 * `--build-arg` that `docker history` reveals, so it can only ever hold a value
 * that is public on purpose (a client pixel key, a Mapbox token). The pattern
 * mirrors the ci-reusable's `bin/publishable` — one rule, two spellings kept in
 * step by matching messages.
 */
const PUBLISHABLE_NAME =
	/^(?:PUBLISHABLE_|PUBLIC_|NEXT_PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_|VITE_|REACT_APP_)|(?:_PUBLISHABLE|_PUBLIC)$/;

/**
 * Read `build_secrets:` — a list of publishable KMS secret NAMES. Each becomes a
 * `--build-arg` once scheduleBuilds fetches its value from KMS. Refuses a name
 * that is not a Dockerfile ARG or not publishable: a real credential in
 * `docker history` is the exact leak this gate exists to prevent.
 */
function parseBuildSecrets(value: unknown, at: string): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new PlatformConfigError(`${at} must be a list of secret names`);
	}
	const out: string[] = [];
	for (let i = 0; i < value.length; i++) {
		const name = value[i];
		if (typeof name !== "string" || !ARG_NAME.test(name)) {
			throw new PlatformConfigError(
				`${at}[${i}] must be a Dockerfile ARG name`,
			);
		}
		if (!PUBLISHABLE_NAME.test(name)) {
			throw new PlatformConfigError(
				`${at}[${i}] "${name}" is not publishable — a build_secret is baked into the image where \`docker history\` reveals it. Rename it (PUBLISHABLE_*, PUBLIC_*, NEXT_PUBLIC_*, VITE_*, REACT_APP_*) if the value is public on purpose; a real credential cannot be a build_secret.`,
			);
		}
		out.push(name);
	}
	return out;
}

export interface DeployTarget {
	cluster: string;
	namespace: string;
	/** Operator deployment surface. Only the hanzo operator is supported. */
	operator: string;
	/**
	 * Operator CRD kind: `App` (canonical) or the `Service` alias. Optional in
	 * `hanzo.yml` — omitted means `App`, which is what nearly the whole fleet
	 * runs. (Legacy `HanzoService` was removed.)
	 */
	crd: string;
	/** Name of the operator workload CR to roll the new image onto. */
	name: string;
}

export interface DeployConfig {
	/** Branch names whose successful builds trigger a rollout. */
	on: string[];
	target: DeployTarget;
}

/**
 * Optional end-to-end test stage. After a successful deploy the platform fires
 * the universe Playwright suite as an in-cluster Job against the live service
 * and records pass/fail on the build row. Reported, not hard-gated, by default.
 */
export interface E2eConfig {
	/** Playwright spec(s) relative to universe/e2e, e.g. `tests/00-health.spec.ts`. */
	spec: string;
	/** Base domain under test (E2E_BASE_DOMAIN). Defaults to hanzo.ai. */
	baseDomain?: string;
	/** universe git ref to test from. Defaults to main. */
	ref?: string;
}

/**
 * Optional publish stage for library / SDK repos. After build (and, when
 * configured, a passing e2e) the platform runs an in-cluster Job that publishes
 * the package to npm and/or PyPI. Registry tokens come from KMS-synced secrets
 * (`npm-token` / `pypi-token`) mounted into the Job — never hardcoded.
 */
export interface PublishConfig {
	/** Publish to npm (`npm publish`). */
	npm: boolean;
	/** Publish to PyPI (`uv build` + `uv publish`). */
	pypi: boolean;
	/** Publish to crates.io (`cargo publish --no-verify`, dependency order). */
	cargo: boolean;
	/**
	 * Ordered crate dirs (relative to `packageDir`) for a cargo workspace, published
	 * bottom-up; already-uploaded versions are skipped, not fatal. Empty = the single
	 * crate at `packageDir`. Ignored unless `cargo` is true.
	 */
	cargoCrates: string[];
	/** Sub-directory of the repo holding the package. Defaults to `.`. */
	packageDir: string;
	/** Build + validate the package but do NOT upload — proves the stage safely. */
	dryRun: boolean;
}

export interface PlatformConfig {
	/**
	 * How the project arrives (HIP-0138). Absent in the document means `image`,
	 * which is what every manifest in the fleet declares today.
	 */
	kind: Kind;
	/**
	 * Where {@link kind} reads its source from, repo-relative, defaulted per kind
	 * by {@link KIND_PATH}. Unused by `image`, whose per-image `context` says it.
	 */
	path: string;
	/**
	 * Images to build: the legacy `build:` block yields a single entry, the
	 * `images:` list (hanzo.yml) one per image. Empty for the chart kinds, whose
	 * delivery is the chart itself.
	 */
	builds: BuildConfig[];
	deploy?: DeployConfig;
	e2e?: E2eConfig;
	publish?: PublishConfig;
	/**
	 * Which side of this repo is the source of truth — `forge`, or the GitHub
	 * repo the forge is downstream of (`owner/name`). Absent means "infer from
	 * the forge's own mirror config", which is right for the ~2,200 repos that
	 * are ordinary pull mirrors. Declare it only where inference is wrong:
	 * a forge-primary repo whose GitHub origin is a curated split
	 * (`source: forge`), or a repo whose upstream the forge no longer records.
	 *
	 * Read verbatim; interpreted by services/ci/forge-source.
	 */
	source?: string;
	/**
	 * Where `build_secrets:` are read in KMS. `path`/`environment` default to
	 * `deploy`/`prod`; the tenant is the platform's own KMS principal (the fetch is
	 * scoped by the access token's `owner`, so it is not restated here). Declared
	 * as `kms:` in hanzo.yml — the same block the ci-reusable reads.
	 */
	kms?: { path: string; environment: string };
}

const VALID_OS: readonly BuildOS[] = ["linux", "darwin", "windows"];
const VALID_ARCH: readonly BuildArch[] = ["amd64", "arm64"];

/**
 * Arches the platform can currently BUILD — the ONE place that knows which
 * arches have a live runner pool. Distinct from `VALID_ARCH` (which arches a
 * config may *declare*): a config may name arm64, but the platform will not
 * *build* it while arm64 is paused.
 *
 * arm64 is PAUSED (2026-04-27): DOKS offers no arm64 droplets, so an arm64
 * build Job targets a non-existent node pool (`runner-pool-arm64`, 0 nodes) and
 * pends forever — wedging the build queue. amd64 is the canonical build path
 * until DigitalOcean ships arm64. To resume arm64: provision the arm64 runner
 * pool, add it to buildkit-job's `ARCH_NODE_POOL`, then re-add "arm64" here —
 * every dual-arch repo then resumes arm64 automatically.
 */
export const BUILDABLE_ARCHES: readonly BuildArch[] = ["amd64"];

/** True when the platform has a live runner pool for this arch right now. */
export function isBuildableArch(arch: BuildArch): boolean {
	return BUILDABLE_ARCHES.includes(arch);
}

/**
 * How a project arrives — one axis, five values (HIP-0138), each exactly one
 * runtime primitive:
 *
 *   image     the repo's Dockerfile, BuildKit `dockerfile.v0` → workload CR
 *   fn        no Dockerfile: hanzoai/pack detects the ecosystem → Function CR
 *   chart     a chart directory → one HelmChart (chart bytes + values)
 *   compose   a compose file → converted to that same HelmChart
 *   universe  a directory of charts → many charts, one release
 *
 * Distinct from `deploy.target.crd`, which names which operator CR a BUILT
 * IMAGE rolls onto and is meaningful only for `image`.
 */
export const KINDS = ["image", "fn", "chart", "compose", "universe"] as const;
export type Kind = (typeof KINDS)[number];

/** Where each kind reads from when `path:` is absent. */
const KIND_PATH: Readonly<Record<Kind, string>> = {
	image: ".",
	fn: ".",
	chart: "chart",
	compose: "compose.yml",
	universe: "charts",
};

/** The kinds whose delivery IS the chart: nothing to build, so no `images:`. */
const CHART_KINDS: readonly Kind[] = ["chart", "compose", "universe"];

const SUPPORTED_OPERATORS = ["hanzo-operator", "hanzo"];
/**
 * Deployable CRD kinds — DERIVED from the operator contract, never re-listed
 * here. `WORKLOAD_KINDS` is the one place that knows which kinds carry an
 * image; a kind added there is accepted by this validator automatically.
 */
const SUPPORTED_CRDS: readonly string[] = WORKLOAD_KINDS;

export class PlatformConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PlatformConfigError";
	}
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(
	obj: Record<string, unknown>,
	key: string,
	path: string,
): string {
	const v = obj[key];
	if (typeof v !== "string" || v.length === 0) {
		throw new PlatformConfigError(`${path}.${key} must be a non-empty string`);
	}
	return v;
}

function optionalString(
	obj: Record<string, unknown>,
	key: string,
	fallback: string,
): string {
	const v = obj[key];
	if (v === undefined) return fallback;
	if (typeof v !== "string" || v.length === 0) {
		throw new PlatformConfigError(
			`${key}, when present, must be a non-empty string`,
		);
	}
	return v;
}

/** An optional string field: undefined when absent, else a non-empty string. */
function optionalStringOrUndef(
	obj: Record<string, unknown>,
	key: string,
	path: string,
): string | undefined {
	const v = obj[key];
	if (v === undefined) return undefined;
	if (typeof v !== "string" || v.length === 0) {
		throw new PlatformConfigError(
			`${path}.${key}, when present, must be a non-empty string`,
		);
	}
	return v;
}

/** A boolean field that defaults to false; rejects non-boolean values. */
function boolField(
	obj: Record<string, unknown>,
	key: string,
	path: string,
): boolean {
	const v = obj[key];
	if (v === undefined) return false;
	if (typeof v !== "boolean") {
		throw new PlatformConfigError(`${path}.${key} must be a boolean`);
	}
	return v;
}

/** Parse + validate the optional `e2e:` block. */
function parseE2e(raw: unknown): E2eConfig | undefined {
	if (raw === undefined) return undefined;
	if (!isObject(raw)) {
		throw new PlatformConfigError("e2e, when present, must be a mapping");
	}
	return {
		spec: requireString(raw, "spec", "e2e"),
		baseDomain: optionalStringOrUndef(raw, "baseDomain", "e2e"),
		ref: optionalStringOrUndef(raw, "ref", "e2e"),
	};
}

/** Optional list-of-strings field; absent or empty yields []. Each entry must be a string. */
function parseStringList(obj: object, key: string, path: string): string[] {
	const raw = (obj as Record<string, unknown>)[key];
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		throw new PlatformConfigError(
			`${path}.${key}, when present, must be a list`,
		);
	}
	return raw.map((v, i) => {
		if (typeof v !== "string") {
			throw new PlatformConfigError(`${path}.${key}[${i}] must be a string`);
		}
		return v;
	});
}

/**
 * A path taken from `hanzo.yml` — under the repository, or under the org in
 * KMS. Both are a name for something below a root, and neither may leave it.
 *
 * These strings end up inside a GENERATED SHELL SCRIPT in the publish Job —
 * `cargoCrates` is interpolated unquoted into `for c in …` because the loop
 * needs word-splitting — and inside a URL, where `kms.path` becomes a path
 * segment. So the safety has to live HERE, at the boundary, not at each use
 * site: an allowlisted charset means no value can ever carry a shell
 * metacharacter (`;`, `|`, `$`, backtick, newline, quote) into that script, and
 * validating once at parse time keeps every consumer safe by construction.
 *
 * Also rejects upward traversal. `..` is the one sequence a URL path resolves
 * away and percent-encoding leaves alone, so it is what a path escapes with —
 * out of the checked-out repo on one side, and out of the addressed folder on
 * the other.
 */
function requireRelativePath(value: string, path: string): string {
	if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(value)) {
		throw new PlatformConfigError(
			`${path} must be a path made of [A-Za-z0-9._/-] and may not start with "-" or "/" (got ${JSON.stringify(value)})`,
		);
	}
	if (value.split("/").includes("..")) {
		throw new PlatformConfigError(
			`${path} must not traverse upward with ".." (got ${JSON.stringify(value)})`,
		);
	}
	return value;
}

/** Parse + validate the optional `publish:` block. */
function parsePublish(raw: unknown): PublishConfig | undefined {
	if (raw === undefined) return undefined;
	if (!isObject(raw)) {
		throw new PlatformConfigError("publish, when present, must be a mapping");
	}
	const npm = boolField(raw, "npm", "publish");
	const pypi = boolField(raw, "pypi", "publish");
	const cargo = boolField(raw, "cargo", "publish");
	if (!npm && !pypi && !cargo) {
		throw new PlatformConfigError(
			"publish requires at least one of npm: true, pypi: true or cargo: true",
		);
	}
	return {
		npm,
		pypi,
		cargo,
		cargoCrates: parseStringList(raw, "cargoCrates", "publish").map((c, i) =>
			requireRelativePath(c, `publish.cargoCrates[${i}]`),
		),
		packageDir: requireRelativePath(
			optionalStringOrUndef(raw, "packageDir", "publish") ?? ".",
			"publish.packageDir",
		),
		dryRun: boolField(raw, "dryRun", "publish"),
	};
}

/** Parse + de-duplicate a matrix list. `def` supplies the default when absent. */
function parseMatrix(
	rawMatrix: unknown,
	path: string,
	def?: MatrixEntry[],
): MatrixEntry[] {
	if (rawMatrix === undefined && def) return def;
	if (!Array.isArray(rawMatrix) || rawMatrix.length === 0) {
		throw new PlatformConfigError(
			`${path} must be a non-empty list of { os, arch } entries`,
		);
	}
	const matrix: MatrixEntry[] = rawMatrix.map((entry, i) => {
		const at = `${path}[${i}]`;
		if (!isObject(entry)) {
			throw new PlatformConfigError(`${at} must be a mapping`);
		}
		const { os, arch } = entry;
		if (!VALID_OS.includes(os as BuildOS)) {
			throw new PlatformConfigError(
				`${at}.os must be one of ${VALID_OS.join(", ")} (got ${JSON.stringify(os)})`,
			);
		}
		if (!VALID_ARCH.includes(arch as BuildArch)) {
			throw new PlatformConfigError(
				`${at}.arch must be one of ${VALID_ARCH.join(", ")} (got ${JSON.stringify(arch)})`,
			);
		}
		return { os: os as BuildOS, arch: arch as BuildArch };
	});
	const seen = new Set<string>();
	for (const m of matrix) {
		const key = `${m.os}/${m.arch}`;
		if (seen.has(key)) {
			throw new PlatformConfigError(`${path} contains duplicate target ${key}`);
		}
		seen.add(key);
	}
	return matrix;
}

/**
 * The tokens a tag-pattern may spell, and what each one is.
 *
 * `{{git.sha}}` is the commit; `{{git.tag}}` is the git tag, on the push that
 * made it. Both hold still. A branch head does not, so there is no token for
 * one — see {@link resolveTag}.
 */
const TOKENS = ["{{git.sha}}", "{{git.tag}}"] as const;

/**
 * A repo's declared `tag-pattern`, or the lane's default.
 *
 * A token this does not know is REFUSED, not passed through. A pattern is a
 * template, so an unknown token survives substitution and becomes part of an
 * image name — `{{git.branch}}` published an image literally called
 * `-git.branch-` the moment nothing answered for it. Refusing names the
 * available tokens, which is the sentence the author of that line needs.
 *
 * A pattern with NO token is refused for the same reason and is the harder half
 * to see: it is not a template but a constant, and a constant is the same image
 * name on every push. `tag-pattern: "v1.2.3"` publishes one tag from `main` and
 * from a side branch alike. Nothing downstream can tell those apart, because
 * downstream reads the RESOLVED name and a version is exactly what it wants to
 * see — the moving part is the pattern, and this is where a pattern is read.
 */
function parseTagPattern(
	entry: Record<string, unknown>,
	at: string,
	fallback: string,
): string {
	const pattern = optionalString(entry, "tag-pattern", fallback);
	const tokens = pattern.match(/\{\{[^}]*\}\}/g) ?? [];
	for (const token of tokens) {
		if (!TOKENS.includes(token as (typeof TOKENS)[number])) {
			throw new PlatformConfigError(
				`${at}.tag-pattern: ${token} is not a tag token. A tag names one build for good, so it is spelled from ${TOKENS.join(" or ")} — a branch head moves and cannot name one.`,
			);
		}
	}
	if (tokens.length === 0) {
		throw new PlatformConfigError(
			`${at}.tag-pattern: "${pattern}" names the same image on every push. A tag names ONE build, so the pattern spells it from ${TOKENS.join(" or ")}.`,
		);
	}
	return pattern;
}

/** Legacy single `build:` block → one BuildConfig. */
function parseBuildBlock(build: Record<string, unknown>): BuildConfig {
	const image = requireString(build, "image", "build");
	if (image.includes(":")) {
		throw new PlatformConfigError(
			"build.image must be a bare repository (no tag); the tag comes from build.tag-pattern",
		);
	}
	if (build.push !== undefined && typeof build.push !== "boolean") {
		throw new PlatformConfigError("build.push must be a boolean");
	}
	return {
		name: "",
		matrix: parseMatrix(build.matrix, "build.matrix"),
		dockerfile: optionalString(build, "dockerfile", "./Dockerfile"),
		context: optionalString(build, "context", "."),
		image,
		tagPattern: parseTagPattern(build, "build", "{{git.sha}}"),
		push: build.push === undefined ? true : build.push === true,
		buildArgs: parseBuildArgs(build.args, "build.args"),
		buildSecrets: parseBuildSecrets(build.build_secrets, "build.build_secrets"),
	};
}

/** One entry of the multi-image `images:` list (hanzo.yml) → one BuildConfig. */
function parseImageEntry(entry: unknown, i: number): BuildConfig {
	const at = `images[${i}]`;
	if (!isObject(entry)) {
		throw new PlatformConfigError(`${at} must be a mapping`);
	}
	const name = requireString(entry, "name", at);
	const repo = requireString(entry, "repo", at);
	if (repo.includes(":")) {
		throw new PlatformConfigError(
			`${at}.repo must be a bare repository (no tag); the tag is derived from tag-suffix`,
		);
	}
	if (entry.push !== undefined && typeof entry.push !== "boolean") {
		throw new PlatformConfigError(`${at}.push must be a boolean`);
	}
	const context = optionalString(entry, "context", ".");
	// Default Dockerfile sits under the build context, matching the cicd runner.
	const dockerfile = optionalString(
		entry,
		"dockerfile",
		`${context}/Dockerfile`,
	);
	// Per-image deterministic tag: `<sha>-<arch>-<suffix>` (suffix defaults to name).
	const suffix = optionalString(entry, "tag-suffix", name);
	// `tag-pattern` is read HERE as well as in the legacy `build:` block, and it
	// was not. Both forms parse the same document and only one honoured the key,
	// so a repo on the modern `images:` list could write
	// `tag-pattern: "{{git.tag}}"`, have the schema accept it, and still publish
	// a commit sha. The declaration was not refused, it was ignored — the one
	// failure mode a config reader must never have.
	//
	// It is why four of universe's image pins name a commit rather than a
	// release: on this path a version was not merely unset, it was unreachable,
	// and the pin gate could only report the symptom. The default is the exact
	// string every current caller already gets, so this widens what CAN be
	// declared and moves nothing that IS.
	const tagPattern = parseTagPattern(entry, at, `{{git.sha}}-amd64-${suffix}`);
	return {
		name,
		matrix: parseMatrix(entry.matrix, `${at}.matrix`, [
			{ os: "linux", arch: "amd64" },
		]),
		dockerfile,
		context,
		image: repo,
		tagPattern,
		push: entry.push === undefined ? true : entry.push === true,
		buildArgs: parseBuildArgs(entry.args, `${at}.args`),
		buildSecrets: parseBuildSecrets(entry.build_secrets, `${at}.build_secrets`),
	};
}

/**
 * Validate a raw parsed object against the `hanzo.yml` / `.platform.yml` schema.
 * Returns a fully-typed `PlatformConfig` or throws `PlatformConfigError`
 * with a path-qualified message identifying the first violation.
 *
 * `kind:` says which of the five arrivals this is (HIP-0138) and defaults to
 * `image`. The image kinds carry one of two build shapes, normalized to
 * `builds[]`:
 *   - `images:` (hanzo.yml) — a list of { name, repo, context, … }, one per image.
 *   - `build:`  (legacy .platform.yml) — a single image block.
 * The chart kinds carry neither: `builds` is empty and `path` locates the chart.
 */
export function validatePlatformConfig(raw: unknown): PlatformConfig | null {
	// An EMPTY document declares nothing, and `yaml` parses a comments-only file
	// to null. That is a real and deliberate state, not a malformed one:
	// hanzo/insights' `.platform.yml` is fourteen lines of prose ending "No
	// build/deploy stanza: this repo produces no served surface".
	if (raw === null || raw === undefined) return null;

	if (!isObject(raw)) {
		throw new PlatformConfigError(
			"config must be a YAML mapping at the top level",
		);
	}

	// How the project arrives. Absent is `image`, so every manifest written
	// before this field keeps its meaning exactly.
	const declared = optionalString(raw, "kind", "image");
	if (!(KINDS as readonly string[]).includes(declared)) {
		throw new PlatformConfigError(
			`kind must be one of ${KINDS.join(", ")} (got ${declared})`,
		);
	}
	const kind = declared as Kind;
	const path = requireRelativePath(
		optionalString(raw, "path", KIND_PATH[kind]),
		"path",
	);

	let builds: BuildConfig[];
	if (CHART_KINDS.includes(kind)) {
		if (raw.images !== undefined || raw.build !== undefined) {
			throw new PlatformConfigError(
				`kind: ${kind} delivers a chart, not a container image — \`images:\` and \`build:\` are invalid`,
			);
		}
		builds = [];
	} else if (Array.isArray(raw.images)) {
		if (raw.images.length === 0) {
			throw new PlatformConfigError("`images` must be a non-empty list");
		}
		builds = raw.images.map(parseImageEntry);
		const names = new Set<string>();
		for (const b of builds) {
			if (names.has(b.name)) {
				throw new PlatformConfigError(`duplicate image name "${b.name}"`);
			}
			names.add(b.name);
		}
	} else if (isObject(raw.build)) {
		builds = [parseBuildBlock(raw.build)];
	} else if (raw.deploy === undefined) {
		// Declares no image AND nothing to roll out: this file exists for the
		// OTHER reader. `hanzo.yml` is the estate's ONE CI manifest and it has two
		// consumers — hanzoai/ci runs its `test:` gate, platform builds its
		// `images:` — so a repo that declares tests and no image is COMPLETE, not
		// broken. hanzoai/cloud's says exactly that in prose ("NO images: lane
		// HERE ... CI's only job here is the TEST GATE on every push").
		//
		// Returning null routes it to the signal the build lane already has for
		// "nothing for me here". Making it an ERROR meant 54 repos answered every
		// push with a 500, which is how a deliberate declaration ends up looking
		// like a broken pipeline.
		return null;
	} else {
		// `deploy:` with nothing to build is INCOHERENT — there is no image to roll
		// out — so this one stays loud. The distinction is the whole point: silence
		// about builds is a choice, a rollout of nothing is a mistake.
		throw new PlatformConfigError(
			"config declares `deploy:` but neither an `images:` list (hanzo.yml) nor a `build:` block (.platform.yml)",
		);
	}

	let kms: PlatformConfig["kms"];
	if (raw.kms !== undefined) {
		if (!isObject(raw.kms)) {
			throw new PlatformConfigError("kms, when present, must be a mapping");
		}
		kms = {
			// The folder addresses a secret on the platform's own KMS principal,
			// and it reaches that request as a path segment. Percent-encoding does
			// not touch a dot, so a folder that traverses upward re-addresses the
			// read — the same rule, for the same reason, as a path into the repo.
			path: requireRelativePath(
				optionalString(raw.kms, "path", "deploy").replace(/^\/+|\/+$/g, ""),
				"kms.path",
			),
			environment: optionalString(raw.kms, "environment", "prod"),
		};
	}

	let deploy: DeployConfig | undefined;
	if (raw.deploy !== undefined) {
		if (!isObject(raw.deploy)) {
			throw new PlatformConfigError("deploy, when present, must be a mapping");
		}
		const d = raw.deploy;
		if (
			!Array.isArray(d.on) ||
			d.on.length === 0 ||
			!d.on.every((b) => typeof b === "string" && b.length > 0)
		) {
			throw new PlatformConfigError(
				"deploy.on must be a non-empty list of branch names",
			);
		}
		// Two deploy shapes: platform-native operator rollout (`target:`) vs the
		// Deployment-style rollout (`services:`, hanzo.yml) owned by the cicd
		// runner / GitOps. The platform only performs the operator-CR rollout, so
		// a `services:`-only deploy is build-only here (deploy left undefined) and
		// falls through to the one return below — every field of the result is
		// assembled in one place, so none of them can be forgotten on one path.
		const operatorRollout =
			d.target !== undefined ||
			(d.services === undefined && d.cluster === undefined);
		if (operatorRollout) {
			if (CHART_KINDS.includes(kind)) {
				throw new PlatformConfigError(
					`kind: ${kind} cannot declare an operator \`deploy.target\` — a chart delivers a HelmChart, not a container image rollout onto a workload CR`,
				);
			}
			if (!isObject(d.target)) {
				throw new PlatformConfigError(
					"deploy.target is required when deploy is set",
				);
			}
			const t = d.target;
			const operator = requireString(t, "operator", "deploy.target");
			if (!SUPPORTED_OPERATORS.includes(operator)) {
				throw new PlatformConfigError(
					`deploy.target.operator must be one of ${SUPPORTED_OPERATORS.join(", ")} (got ${operator})`,
				);
			}
			// `crd` is optional: the overwhelming majority of the fleet is `App`, so
			// a repo that omits it gets `App` rather than a validation error. Naming
			// a kind outside the supported set still fails loudly.
			const crd = optionalString(t, "crd", DEFAULT_WORKLOAD_KIND);
			if (!SUPPORTED_CRDS.includes(crd)) {
				throw new PlatformConfigError(
					`deploy.target.crd must be one of ${SUPPORTED_CRDS.join(", ")} (the operator removed legacy HanzoService — one way only)`,
				);
			}
			deploy = {
				on: d.on as string[],
				target: {
					cluster: requireString(t, "cluster", "deploy.target"),
					namespace: requireString(t, "namespace", "deploy.target"),
					operator,
					crd,
					name: requireString(t, "name", "deploy.target"),
				},
			};
		}
	}

	return {
		kind,
		path,
		builds,
		deploy,
		e2e: parseE2e(raw.e2e),
		publish: parsePublish(raw.publish),
		kms,
	};
}

/**
 * Parse + validate a repo's CI config text.
 *
 * Returns null when the document declares nothing for the BUILD lane — empty,
 * comments-only, or `test:`-only — which is a legitimate state, not a failure.
 * Throws `PlatformConfigError` on input that is genuinely wrong: unparseable
 * YAML, a non-mapping document, a `deploy:` with no build, a malformed image.
 */
export function parsePlatformConfig(yamlText: string): PlatformConfig | null {
	let raw: unknown;
	try {
		raw = parseYaml(yamlText);
	} catch (err) {
		throw new PlatformConfigError(`not valid YAML: ${(err as Error).message}`);
	}
	const config = validatePlatformConfig(raw);
	// Attached here, once, rather than threaded through validatePlatformConfig's
	// several return sites — `source:` is orthogonal to what gets built, and
	// duplicating it into each of those returns is how one of them ends up
	// forgetting it.
	if (config && isObject(raw) && typeof raw.source === "string") {
		const source = raw.source.trim();
		if (source) config.source = source;
	}
	return config;
}

/**
 * Forge owner → org login.
 *
 * The forge names the Hanzo org `hanzo` and GitHub names it `hanzoai`. `luxfi`
 * and `zooai` are spelled identically on both sides and so are absent: an
 * unmapped owner passes through verbatim.
 *
 * This spells an ORG, and it is used to name the runner pool below and nothing
 * else. It never spells a REPOSITORY: `hanzo/kms` and `hanzoai/kms` are two
 * repositories on the forge, with their own contents and their own writers, so
 * carrying this mapping across a `owner/name` would name a repository nobody
 * asked to build. NEVER add per-repo entries here; if a repo needs
 * special-casing, the mapping is wrong.
 */
const OWNER_TO_ORG: Readonly<Record<string, string>> = {
	hanzo: "hanzoai",
};

/**
 * Org login → ARC pool brand prefix. ARC scale sets are named by
 * BRAND (`hanzo`, `lux`, `zoo`), not by the org's GitHub login (`hanzoai`,
 * `luxfi`, `zooai`). An org absent from this table is its own brand
 * (`hanzobot` → `hanzobot`), which is the forward-safe default for any new
 * org that names its pools after its login.
 */
const ORG_TO_BRAND: Readonly<Record<string, string>> = {
	hanzoai: "hanzo",
	luxfi: "lux",
	zooai: "zoo",
	// `bootnode` has no self-hosted runners of its own (its GitHub-Actions CI
	// dead-ends because the arc pools are org-scoped to hanzoai). Its builds run
	// on the shared in-cluster `hanzo-build-*` arcbuild pool, so map the org to
	// the `hanzo` brand rather than letting it default to a nonexistent
	// `bootnode-build-*` pool.
	bootnode: "hanzo",
};

/** Pool role segment. The build scheduler dispatches build jobs only. */
export type RunnerRole = "build" | "deploy";

/**
 * arcd pool label for a repository's owner + matrix entry, e.g.
 * `runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" })` →
 * `hanzo-build-linux-amd64`. This MUST match the live ARC scale-set name in
 * `arc-system` exactly, or the dispatched job's `runs-on` matches no runner
 * and hangs. Scale sets follow `<brand>-<role>-<os>-<arch>`.
 *
 * `owner` is the owner segment of the repository being built, as its forge
 * names it, so both spellings of one org land on one pool. This is the only
 * place either spelling matters, and the pool label is the only thing it names.
 */
export function runnerPoolFor(
	owner: string,
	entry: MatrixEntry,
	role: RunnerRole = "build",
): string {
	const org = OWNER_TO_ORG[owner] ?? owner;
	const brand = ORG_TO_BRAND[org] ?? org;
	const osLabel = entry.os === "darwin" ? "macos" : entry.os;
	return `${brand}-${role}-${osLabel}-${entry.arch}`;
}

/**
 * Resolve a tag-pattern template against the triggering git context.
 *
 * What comes out is a docker tag, so every token goes in as one — this is where
 * the resolver's own output is made a tag, whatever the context said. The tag
 * names an image, and the image name is one field of the exporter the build
 * muscle writes, so a character a tag cannot hold is not one this can emit.
 *
 * TWO tokens, and they are the two names that hold still: the commit, and the
 * git tag. Returns null when the pattern uses `{{git.tag}}` but the push was to
 * a branch — a tag-patterned build has no image name on a branch push, and
 * inventing one would give a single token two meanings. The caller skips the
 * build instead, so a `v*` image is published when, and only when, a `v*` tag
 * is pushed.
 *
 * There is no branch token. A branch head is the one git name that moves, so
 * every name it could spell is one an image must not carry: an ordinary branch
 * name moves under whatever it published, and a branch NAMED like a version
 * publishes a release from something that is not one. `{{git.tag}}` is how a
 * push spells a version, and it can only do so on the push that made the tag.
 */
export function resolveTag(
	pattern: string,
	ctx: { sha: string; ref: string },
): string | null {
	const tag = pattern.includes("{{git.tag}}") ? tagOf(ctx.ref) : "";
	if (tag === null) return null;
	return pattern
		.replaceAll("{{git.tag}}", sanitizeTagSegment(tag))
		.replaceAll("{{git.sha}}", sanitizeTagSegment(ctx.sha));
}

/** Docker tags allow only [A-Za-z0-9._-]; everything else collapses to `-`. */
function sanitizeTagSegment(s: string): string {
	return s.replace(/[^a-zA-Z0-9._-]/g, "-");
}
