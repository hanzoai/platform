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
	build: BuildConfig;
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

/**
 * Validate a raw parsed object against the `.platform.yml` schema.
 * Returns a fully-typed `PlatformConfig` or throws `PlatformConfigError`
 * with a path-qualified message identifying the first violation.
 */
export function validatePlatformConfig(raw: unknown): PlatformConfig {
	if (!isObject(raw)) {
		throw new PlatformConfigError(
			".platform.yml must be a YAML mapping at the top level",
		);
	}

	if (!isObject(raw.build)) {
		throw new PlatformConfigError(".platform.yml: `build` block is required");
	}
	const build = raw.build;

	if (!Array.isArray(build.matrix) || build.matrix.length === 0) {
		throw new PlatformConfigError(
			"build.matrix must be a non-empty list of { os, arch } entries",
		);
	}
	const matrix: MatrixEntry[] = build.matrix.map((entry, i) => {
		const at = `build.matrix[${i}]`;
		if (!isObject(entry)) {
			throw new PlatformConfigError(`${at} must be a mapping`);
		}
		const os = entry.os;
		const arch = entry.arch;
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

	// Reject duplicate matrix entries — they would enqueue colliding jobs.
	const seen = new Set<string>();
	for (const m of matrix) {
		const key = `${m.os}/${m.arch}`;
		if (seen.has(key)) {
			throw new PlatformConfigError(
				`build.matrix contains duplicate target ${key}`,
			);
		}
		seen.add(key);
	}

	const image = requireString(build, "image", "build");
	if (image.includes(":")) {
		throw new PlatformConfigError(
			"build.image must be a bare repository (no tag); the tag comes from build.tag-pattern",
		);
	}

	const dispatchRaw = build.dispatch;
	if (
		dispatchRaw !== undefined &&
		dispatchRaw !== "native" &&
		dispatchRaw !== "workflow_dispatch"
	) {
		throw new PlatformConfigError(
			`build.dispatch must be one of native, workflow_dispatch (got ${JSON.stringify(dispatchRaw)})`,
		);
	}

	const buildConfig: BuildConfig = {
		matrix,
		dockerfile: optionalString(build, "dockerfile", "./Dockerfile"),
		context: optionalString(build, "context", "."),
		image,
		tagPattern: optionalString(build, "tag-pattern", "{{git.sha}}"),
		push: build.push === undefined ? true : build.push === true,
		dispatch: (dispatchRaw as DispatchMode | undefined) ?? "native",
	};

	if (build.push !== undefined && typeof build.push !== "boolean") {
		throw new PlatformConfigError("build.push must be a boolean");
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

	return { build: buildConfig, deploy };
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

/** arcd pool label for an org + matrix entry, e.g. `hanzoai-linux-amd64`. */
export function runnerPoolFor(org: string, entry: MatrixEntry): string {
	const osLabel = entry.os === "darwin" ? "macos" : entry.os;
	return `${org}-${osLabel}-${entry.arch}`;
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
