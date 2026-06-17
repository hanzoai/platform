/**
 * Kubernetes template loader for the Hanzo Platform.
 *
 * Provides:
 *   1. `loadManifest(name)` -- load a raw infrastructure YAML manifest
 *   2. `loadStackYaml(filename)` -- load a raw one-click stack YAML
 *   3. `renderStack(template, ctx)` -- render a stack YAML with variable substitution
 *   4. `resolveSecrets(secrets)` -- resolve `{{random:N}}` expressions
 *   5. `resolveVariables(vars, secrets)` -- resolve `{{secret:key}}` expressions
 *   6. `buildStackContext(template, overrides)` -- build a full SubstitutionContext
 *   7. `findTemplate(name, version?)` -- look up a stack template in the registry
 *   8. `listTemplates()` / `listCategories()` -- enumerate the registry
 *
 * Ported from:
 *   - paas/platform/handlers/manifests/*
 *   - paas/platform/handlers/templates/index.js
 *   - paas/platform/handlers/templates/middlewares.js
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, parseAllDocuments } from "yaml";

import { stackRegistry } from "./registry";
import type {
	InfraManifest,
	StackCategory,
	StackTemplate,
	StackTemplateConfig,
	SubstitutionContext,
} from "./types";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MANIFESTS_DIR = join(__dirname, "manifests");
const STACKS_DIR = join(__dirname, "stacks");

// ---------------------------------------------------------------------------
// 1. Raw manifest loading
// ---------------------------------------------------------------------------

/**
 * Load a raw infrastructure manifest YAML string by name.
 *
 * Valid names: deployment, statefulset, cronjob, service, namespace,
 *              pvc, hpa, github-pipeline, gitlab-pipeline, bitbucket-pipeline
 */
export function loadManifest(name: InfraManifest): string {
	const filePath = join(MANIFESTS_DIR, `${name}.yaml`);
	return readFileSync(filePath, "utf-8");
}

/**
 * Load a raw infrastructure manifest as parsed YAML documents.
 * Returns an array because pipeline manifests contain multiple documents.
 */
export function loadManifestParsed(name: InfraManifest): unknown[] {
	const raw = loadManifest(name);
	return parseAllDocuments(raw).map((doc) => doc.toJSON());
}

/**
 * Load a raw one-click stack template YAML string by filename.
 *
 * Example: `loadStackYaml("postgresqlv1.0.yaml")`
 */
export function loadStackYaml(filename: string): string {
	const filePath = join(STACKS_DIR, filename);
	return readFileSync(filePath, "utf-8");
}

/**
 * Load a one-click stack YAML as parsed documents.
 */
export function loadStackParsed(filename: string): unknown[] {
	const raw = loadStackYaml(filename);
	return parseAllDocuments(raw).map((doc) => doc.toJSON());
}

// ---------------------------------------------------------------------------
// 2. Secret generation  ({{random:N}} expressions)
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random alphanumeric string of the given length.
 */
export function generateSecret(length: number): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	const bytes = randomBytes(length);
	let result = "";
	for (let i = 0; i < length; i++) {
		result += chars[(bytes[i] ?? 0) % chars.length];
	}
	return result;
}

const RANDOM_EXPR = /\{\{\s*random:(\d+)\s*\}\}/;

/**
 * Resolve secret expressions in a secrets object.
 *
 * - `{{random:N}}` is replaced with a random string of length N.
 * - Literal strings are kept as-is.
 *
 * Returns a new object with all expressions resolved.
 */
export function resolveSecrets(
	secrets: Record<string, string>,
): Record<string, string> {
	const resolved: Record<string, string> = {};
	for (const [key, value] of Object.entries(secrets)) {
		const match = value.match(RANDOM_EXPR);
		if (match?.[1]) {
			resolved[key] = generateSecret(parseInt(match[1], 10));
		} else {
			resolved[key] = value;
		}
	}
	return resolved;
}

// ---------------------------------------------------------------------------
// 3. Variable resolution  ({{secret:key}} expressions)
// ---------------------------------------------------------------------------

const SECRET_REF_EXPR = /\{\{\s*secret:(\w+)\s*\}\}/;

/**
 * Resolve variable expressions.
 *
 * - `{{secret:keyName}}` is replaced with the corresponding resolved secret value.
 * - Literal strings are kept as-is.
 *
 * Returns an array of `{ name, value }` pairs suitable for Kubernetes env vars.
 */
export function resolveVariables(
	variables: Record<string, string>,
	resolvedSecrets: Record<string, string>,
): Array<{ name: string; value: string }> {
	const result: Array<{ name: string; value: string }> = [];
	for (const [name, rawValue] of Object.entries(variables)) {
		let value = rawValue;
		const match = rawValue.match(SECRET_REF_EXPR);
		if (match?.[1]) {
			value = resolvedSecrets[match[1]] ?? "";
		}
		result.push({ name, value });
	}
	return result;
}

// ---------------------------------------------------------------------------
// 4. Mustache-style template substitution for stack YAMLs
// ---------------------------------------------------------------------------

/**
 * Escape a string value so it is safe to interpolate into YAML.
 *
 * If the value contains characters that could break YAML structure
 * (colons, newlines, quotes, anchors, etc.), wrap it in double quotes
 * using JSON.stringify which produces valid YAML double-quoted scalars.
 */
function escapeYamlValue(value: string): string {
	if (/[\n\r:{}[\],&*#?|<>=!%@`"'\\]/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

/**
 * Recursively get a value from a nested object using a dot-separated path.
 *
 * Example: `getPath(ctx, "podConfig.memoryRequestType")` => "mebibyte"
 */
function getPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		// Support array index access like `variables.0.name`
		const idx = Number(part);
		if (Array.isArray(current) && !isNaN(idx)) {
			current = (current as unknown[])[idx];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}
	return current;
}

/**
 * Replace all `{{path.to.value}}` expressions in a YAML string with values
 * from the given substitution context.
 *
 * All substituted string values are YAML-escaped to prevent injection.
 *
 * Unresolved expressions are left as-is (to allow multi-pass rendering or
 * to surface missing variables clearly).
 */
export function substituteTemplate(
	yamlStr: string,
	ctx: SubstitutionContext,
): string {
	return yamlStr.replace(
		/\{\{([^}]+)\}\}/g,
		(match: string, expr: string) => {
			const trimmed = expr.trim();
			const value = getPath(ctx as unknown as Record<string, unknown>, trimmed);
			if (value === undefined || value === null) {
				return match; // leave unresolved
			}
			const strValue = String(value);
			return escapeYamlValue(strValue);
		},
	);
}

// ---------------------------------------------------------------------------
// 5. High-level stack rendering
// ---------------------------------------------------------------------------

/**
 * Build a full SubstitutionContext from a StackTemplate's config and optional
 * user overrides.
 *
 * This mirrors the logic from paas middlewares.js `constructCreateRequestBodyForTemplate`:
 *   1. Apply default values from the template config
 *   2. Resolve secrets ({{random:N}})
 *   3. Resolve variables ({{secret:key}})
 *   4. Merge user overrides on top
 */
export function buildStackContext(
	template: StackTemplate,
	overrides: Partial<SubstitutionContext> & { iid: string; namespace: string },
): SubstitutionContext {
	const { config } = template;

	// Start with an empty context seeded by iid and namespace
	const ctx: SubstitutionContext = {
		iid: overrides.iid,
		namespace: overrides.namespace,
		secrets: {},
		registry: {},
		podConfig: {
			cpuRequest: 100,
			cpuRequestType: "millicores",
			cpuLimit: 1,
			cpuLimitType: "cores",
			memoryRequest: 256,
			memoryRequestType: "mebibyte",
			memoryLimit: 1,
			memoryLimitType: "gibibyte",
		},
		storageConfig: {
			enabled: false,
			size: 1,
			sizeType: "gibibyte",
		},
	};

	// Apply default values from the template config, expanding dot-paths
	applyDefaults(ctx as unknown as Record<string, unknown>, config.defaultValues);

	// Resolve secrets
	ctx.secrets = resolveSecrets(config.secrets);

	// Resolve variables
	ctx.variables = resolveVariables(config.variables, ctx.secrets);

	// Merge user overrides (deep-ish: one level)
	if (overrides.registry) Object.assign(ctx.registry, overrides.registry);
	if (overrides.podConfig) Object.assign(ctx.podConfig, overrides.podConfig);
	if (overrides.storageConfig)
		Object.assign(ctx.storageConfig, overrides.storageConfig);
	if (overrides.statefulSetConfig)
		ctx.statefulSetConfig = {
			...ctx.statefulSetConfig,
			...overrides.statefulSetConfig,
		};
	if (overrides.deploymentConfig)
		ctx.deploymentConfig = {
			...ctx.deploymentConfig,
			...overrides.deploymentConfig,
		};
	if (overrides.networking)
		ctx.networking = { ...ctx.networking, ...overrides.networking };
	if (overrides.secrets) Object.assign(ctx.secrets, overrides.secrets);
	if (overrides.variables) ctx.variables = overrides.variables;

	return ctx;
}

/**
 * Render a one-click stack template into fully-substituted YAML.
 *
 * Usage:
 * ```ts
 * const tpl = findTemplate("PostgreSQL")!;
 * const yaml = renderStack(tpl, { iid: "pg-abc123", namespace: "my-ns" });
 * ```
 */
export function renderStack(
	template: StackTemplate,
	overrides: Partial<SubstitutionContext> & { iid: string; namespace: string },
): string {
	const ctx = buildStackContext(template, overrides);
	const rawYaml = loadStackYaml(template.manifest);
	return substituteTemplate(rawYaml, ctx);
}

// ---------------------------------------------------------------------------
// 6. Registry queries
// ---------------------------------------------------------------------------

/** Return all stack categories. */
export function listCategories(): StackCategory[] {
	return stackRegistry;
}

/** Return a flat list of all stack templates across all categories. */
export function listTemplates(): StackTemplate[] {
	return stackRegistry.flatMap((cat) => cat.templates);
}

/**
 * Find a template by name and optional version.
 * If version is omitted, returns the latest.
 */
export function findTemplate(
	name: string,
	version?: string,
): StackTemplate | undefined {
	for (const category of stackRegistry) {
		for (const tpl of category.templates) {
			if (tpl.name !== name) continue;
			if (version && tpl.version !== version) continue;
			if (!version && !tpl.isLatest) continue;
			return tpl;
		}
	}
	return undefined;
}

/**
 * Find a template by manifest filename.
 */
export function findTemplateByManifest(
	manifest: string,
): StackTemplate | undefined {
	for (const category of stackRegistry) {
		for (const tpl of category.templates) {
			if (tpl.manifest === manifest) return tpl;
		}
	}
	return undefined;
}

/**
 * Find the category that contains the named template.
 */
export function findCategory(templateName: string): string | undefined {
	for (const category of stackRegistry) {
		for (const tpl of category.templates) {
			if (tpl.name === templateName) return category.category;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Apply dot-path default values onto a context object.
 * e.g. `"podConfig.cpuRequest": 100` sets `ctx.podConfig.cpuRequest = 100`
 */
function applyDefaults(
	ctx: Record<string, unknown>,
	defaults: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(defaults)) {
		const parts = key.split(".");
		let current: Record<string, unknown> = ctx;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (part === undefined) continue;
			if (
				current[part] == null ||
				typeof current[part] !== "object" ||
				Array.isArray(current[part])
			) {
				current[part] = {};
			}
			current = current[part] as Record<string, unknown>;
		}
		const lastPart = parts[parts.length - 1];
		if (lastPart !== undefined) {
			current[lastPart] = value;
		}
	}
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { stackRegistry } from "./registry";
export type {
	InfraManifest,
	StackCategory,
	StackTemplate,
	StackTemplateConfig,
	SubstitutionContext,
	PodConfig,
	StorageConfig,
	StatefulSetConfig,
	DeploymentConfig,
	NetworkingConfig,
	RegistryConfig,
	StackType,
} from "./types";
