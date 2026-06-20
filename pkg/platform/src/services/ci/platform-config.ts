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

export type BuildOS = "linux" | "darwin" | "windows";
export type BuildArch = "amd64" | "arm64";

export interface MatrixEntry {
	os: BuildOS;
	arch: BuildArch;
}

/**
 * How a build job reaches a runner:
 *   - `native`           — enqueue onto platform's long-poll fabric; an arcd
 *                          runner pulls it via POST /v1/arcd/poll. The default.
 *   - `workflow_dispatch`— the legacy GHA path; platform calls GitHub's
 *                          workflow_dispatch API. Opt-in fallback for repos
 *                          that have not migrated their runners to long-poll.
 *
 * Even under `native`, a pool with NO live registered runner transparently
 * falls back to `workflow_dispatch` so a build is never stranded — the
 * `native` choice is "prefer long-poll", not "long-poll or nothing".
 */
export type DispatchMode = "native" | "workflow_dispatch";

export interface BuildConfig {
	/** Image name (multi-image `images:` form); empty for the legacy `build:` form. */
	name: string;
	matrix: MatrixEntry[];
	dockerfile: string;
	context: string;
	image: string;
	/** Tag template; only `{{git.sha}}` and `{{git.branch}}` are supported. */
	tagPattern: string;
	push: boolean;
	/** Runner dispatch mode. Defaults to `native` (long-poll). */
	dispatch: DispatchMode;
}

export interface DeployTarget {
	cluster: string;
	namespace: string;
	/** Operator deployment surface. Only the hanzo operator is supported. */
	operator: string;
	/** Operator CRD kind. Must be `Service` (legacy `HanzoService` was removed). */
	crd: string;
	/** Name of the operator Service CR to roll the new image onto. */
	name: string;
}

export interface DeployConfig {
	/** Branch names whose successful builds trigger a rollout. */
	on: string[];
	target: DeployTarget;
}

export interface PlatformConfig {
	/**
	 * One or more images to build. The legacy `build:` block yields a single
	 * entry; the `images:` list (hanzo.yml) yields one per image. Always
	 * non-empty.
	 */
	builds: BuildConfig[];
	deploy?: DeployConfig;
}

const VALID_OS: readonly BuildOS[] = ["linux", "darwin", "windows"];
const VALID_ARCH: readonly BuildArch[] = ["amd64", "arm64"];
const SUPPORTED_OPERATORS = ["hanzo-operator", "hanzo"];
const SUPPORTED_CRDS = ["Service"];

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

function parseDispatch(raw: unknown, path: string): DispatchMode {
	if (raw !== undefined && raw !== "native" && raw !== "workflow_dispatch") {
		throw new PlatformConfigError(
			`${path}.dispatch must be one of native, workflow_dispatch (got ${JSON.stringify(raw)})`,
		);
	}
	return (raw as DispatchMode | undefined) ?? "native";
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
		tagPattern: optionalString(build, "tag-pattern", "{{git.sha}}"),
		push: build.push === undefined ? true : build.push === true,
		dispatch: parseDispatch(build.dispatch, "build"),
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
	const dockerfile = optionalString(entry, "dockerfile", `${context}/Dockerfile`);
	// Per-image deterministic tag: `<sha>-<arch>-<suffix>` (suffix defaults to name).
	const suffix = optionalString(entry, "tag-suffix", name);
	return {
		name,
		matrix: parseMatrix(entry.matrix, `${at}.matrix`, [
			{ os: "linux", arch: "amd64" },
		]),
		dockerfile,
		context,
		image: repo,
		tagPattern: `{{git.sha}}-amd64-${suffix}`,
		push: entry.push === undefined ? true : entry.push === true,
		dispatch: parseDispatch(entry.dispatch, at),
	};
}

/**
 * Validate a raw parsed object against the `hanzo.yml` / `.platform.yml` schema.
 * Returns a fully-typed `PlatformConfig` or throws `PlatformConfigError`
 * with a path-qualified message identifying the first violation.
 *
 * Two build shapes are accepted, normalized to `builds[]`:
 *   - `images:` (hanzo.yml) — a list of { name, repo, context, … }, one per image.
 *   - `build:`  (legacy .platform.yml) — a single image block.
 */
export function validatePlatformConfig(raw: unknown): PlatformConfig {
	if (!isObject(raw)) {
		throw new PlatformConfigError(
			"config must be a YAML mapping at the top level",
		);
	}

	let builds: BuildConfig[];
	if (Array.isArray(raw.images)) {
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
	} else {
		throw new PlatformConfigError(
			"config requires either an `images:` list (hanzo.yml) or a `build:` block (.platform.yml)",
		);
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
		// a `services:`-only deploy is build-only here (deploy left undefined).
		if (d.target === undefined && (d.services !== undefined || d.cluster !== undefined)) {
			return { builds, deploy: undefined };
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
		const crd = requireString(t, "crd", "deploy.target");
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

	return { builds, deploy };
}

/** Parse + validate `.platform.yml` text. Throws `PlatformConfigError` on bad input. */
export function parsePlatformConfig(yamlText: string): PlatformConfig {
	let raw: unknown;
	try {
		raw = parseYaml(yamlText);
	} catch (err) {
		throw new PlatformConfigError(
			`.platform.yml is not valid YAML: ${(err as Error).message}`,
		);
	}
	return validatePlatformConfig(raw);
}

/**
 * GitHub org login → ARC pool brand prefix. ARC scale sets are named by
 * BRAND (`hanzo`, `lux`, `zoo`), not by the org's GitHub login (`hanzoai`,
 * `luxfi`, `zooai`). An org absent from this table is its own brand
 * (`hanzobot` → `hanzobot`), which is the forward-safe default for any new
 * org that names its pools after its login.
 */
const ORG_TO_BRAND: Readonly<Record<string, string>> = {
	hanzoai: "hanzo",
	luxfi: "lux",
	zooai: "zoo",
};

/** Pool role segment. The build scheduler dispatches build jobs only. */
export type RunnerRole = "build" | "deploy";

/**
 * arcd pool label for an org + matrix entry, e.g.
 * `runnerPoolFor("hanzoai", { os: "linux", arch: "amd64" })` →
 * `hanzo-build-linux-amd64`. This MUST match the live ARC scale-set name in
 * `arc-system` exactly, or the dispatched job's `runs-on` matches no runner
 * and hangs. Scale sets follow `<brand>-<role>-<os>-<arch>`.
 */
export function runnerPoolFor(
	org: string,
	entry: MatrixEntry,
	role: RunnerRole = "build",
): string {
	const brand = ORG_TO_BRAND[org] ?? org;
	const osLabel = entry.os === "darwin" ? "macos" : entry.os;
	return `${brand}-${role}-${osLabel}-${entry.arch}`;
}

/** Resolve a tag-pattern template against the triggering git context. */
export function resolveTag(
	tagPattern: string,
	ctx: { sha: string; branch: string },
): string {
	return tagPattern
		.replaceAll("{{git.sha}}", ctx.sha)
		.replaceAll("{{git.branch}}", ctx.branch.replace(/[^a-zA-Z0-9._-]/g, "-"));
}
