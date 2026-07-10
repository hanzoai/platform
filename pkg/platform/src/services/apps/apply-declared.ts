/**
 * Declared-CR apply — the "apply" half of the control plane's deploy loop, the
 * platform-native replacement for the `gitops-reconcile` kubectl cron.
 *
 * The deploy chain is: service CI → `image-update` bumps the operator CR in git
 * → merge main → <git→CR apply> → hanzo operator reconciles the CR into a
 * Deployment. ArgoCD used to be the <git→CR apply> step and was torn down; the
 * kubectl cron restored it as a shim. THIS module is the durable, native step:
 * it fetches the declared `Service` CRs from `hanzoai/universe`
 * (`infra/k8s/operator/crs/*.yaml`, the desired state) and applies the
 * reconcilable subset into the cluster. It does NOT re-implement the operator
 * (which already reconciles CRs → Deployments); it only pushes git → CR.
 *
 * SEPARATION OF CONCERNS (one way, orthogonal):
 *   - apply (this module): git → CR. Writes the declared `Service` CRs.
 *   - observe (`inventory.ts`): CR + Deployment → drift/health. Reads only.
 *   The two compose in the scheduler (apply-then-observe) and share exactly ONE
 *   cluster-write primitive — `applyServiceCR` (`../k8s/operator`).
 *
 * SAFE BY CONSTRUCTION (mirrors the cron's guarantees):
 *   - NEVER deletes / prunes: create-or-update only (`applyServiceCR`). A CR
 *     removed from git is left alone.
 *   - Applies ONLY the RECONCILABLE set, never all ~79 CRs (some would fight a
 *     live plain Deployment). Membership is a DURABLE per-CR marker
 *     (`hanzo.ai/reconcile: platform`, label or annotation) so it lives with the
 *     CR in git — the "one way" improvement over the cron's env allowlist. For
 *     the transition, the seed allowlist (the cron's vetted 22) is honored too;
 *     it retires as CRs gain the marker.
 *   - Best-effort per-CR: one CR's failure never aborts the rest (collected +
 *     reported).
 *   - Incremental: applies a CR only when its file's git blob sha changed since
 *     the last successful apply (or on first pass / pod restart), so steady
 *     state is ONE cheap directory-listing call per tick and zero redundant
 *     applies — instant on a universe merge, gentle on the GitHub API.
 *
 * Auth: the universe repo cred comes from the platform's own GitHub App
 * installation (`appEnvOctokit`, from the KMS-synced `GITHUB_APP_*` env) — never
 * a hardcoded token, never logged.
 */

import { appEnvOctokit } from "@hanzo/platform/utils/providers/github";
import type { Octokit } from "octokit";
import { parseAllDocuments } from "yaml";
import {
	type ApplyOptions,
	applyServiceCR,
	type CustomResource,
	OPERATOR_GROUP,
	OPERATOR_VERSION,
	type OperatorServiceSpec,
} from "../k8s/operator";

// ---------------------------------------------------------------------------
// Source of truth: hanzoai/universe → infra/k8s/operator/crs/*.yaml (main)
// ---------------------------------------------------------------------------

const UNIVERSE_OWNER = "hanzoai";
const UNIVERSE_REPO = "universe";
const UNIVERSE_BRANCH = "main";
const CRS_DIR = "infra/k8s/operator/crs";

// ---------------------------------------------------------------------------
// Reconcilable membership — marker (durable, in git) OR seed allowlist
// ---------------------------------------------------------------------------

/**
 * The durable opt-in marker. A `Service` CR carrying
 * `hanzo.ai/reconcile: platform` (as a label OR annotation) is applied by this
 * module. Membership lives WITH the CR in git — the one-way replacement for the
 * cron's out-of-band env allowlist.
 */
export const RECONCILE_LABEL = "hanzo.ai/reconcile";
/** The marker value that opts a CR into platform-apply. */
export const RECONCILE_PLATFORM = "platform";

/**
 * Seed allowlist — the exact vetted subset the `gitops-reconcile` cron applies
 * today (`RECONCILE_ALLOWLIST`). Preserved verbatim so this path's behavior
 * matches the cron's on day one (it does NOT suddenly start applying all CRs).
 * A CR is reconcilable if it bears the marker OR its name is in this seed set.
 * The seed set RETIRES as CRs gain the `hanzo.ai/reconcile: platform` marker in
 * git (a separate universe change — this PR does not edit the CRs).
 */
export const SEED_ALLOWLIST: ReadonlySet<string> = new Set([
	"functions",
	"admin-guard",
	"analytics",
	"bot-gateway",
	"bot-hub",
	"gallery-site",
	"hanzo-app",
	"hanzo-bot-site",
	"hanzo-playground",
	"hanzo-vote",
	"karma-style",
	"maxpower-assistant",
	"maxpower-chat",
	"maxpower-pics",
	"rag-api",
	"social-backend",
	"social-frontend",
	"social-orchestrator",
	"tryon-karma",
	"vector",
	"visor",
	"world",
]);

/** The subset of a parsed CR this module reasons about (the rest is opaque). */
export interface ParsedCR {
	apiVersion?: string;
	kind?: string;
	metadata?: {
		name?: string;
		namespace?: string;
		labels?: Record<string, string>;
		annotations?: Record<string, string>;
	};
	spec?: unknown;
}

/**
 * Whether platform-apply should apply this CR. True iff it is a `hanzo.ai/v1`
 * `Service` AND it opts in — via the `hanzo.ai/reconcile: platform` marker
 * (label or annotation) OR its name being in the seed allowlist. Pure; the
 * load-bearing safety gate, unit-tested without a cluster.
 */
export function isReconcilable(cr: ParsedCR): boolean {
	if (cr.apiVersion !== `${OPERATOR_GROUP}/${OPERATOR_VERSION}`) return false;
	if (cr.kind !== "Service") return false;
	const meta = cr.metadata;
	const name = meta?.name;
	if (!name) return false;
	const marker =
		meta?.labels?.[RECONCILE_LABEL] ?? meta?.annotations?.[RECONCILE_LABEL];
	if (marker === RECONCILE_PLATFORM) return true;
	return SEED_ALLOWLIST.has(name);
}

// ---------------------------------------------------------------------------
// Source seam (dependency-injected so the apply is testable with no IO)
// ---------------------------------------------------------------------------

/** One CR file in the universe `crs/` directory. */
export interface UniverseFile {
	/** Basename, e.g. `functions.yaml`. */
	name: string;
	/** Repo-relative path, e.g. `infra/k8s/operator/crs/functions.yaml`. */
	path: string;
	/** Git blob sha — the change key for the incremental apply. */
	sha: string;
}

/**
 * The IO the apply depends on, injected so tests exercise the real
 * parse/filter/apply logic against fakes (no GitHub, no cluster).
 */
export interface DeclaredCRsSource {
	/** List `crs/*.yaml` (name + path + sha). */
	list(): Promise<UniverseFile[]>;
	/** Read one file's raw YAML text by repo-relative path. */
	read(path: string): Promise<string>;
	/** Apply one `Service` CR (idempotent create-or-update). */
	apply(
		cr: CustomResource<OperatorServiceSpec>,
		opts?: ApplyOptions,
	): Promise<void>;
}

/** Directory-listing entry shape we read (a minimal slice of getContent). */
type ContentEntry = { type?: string; name: string; path: string; sha: string };

async function listUniverseCRs(octokit: Octokit): Promise<UniverseFile[]> {
	const res = await octokit.rest.repos.getContent({
		owner: UNIVERSE_OWNER,
		repo: UNIVERSE_REPO,
		path: CRS_DIR,
		ref: UNIVERSE_BRANCH,
	});
	const items = (Array.isArray(res.data) ? res.data : []) as ContentEntry[];
	return items
		.filter(
			(e) =>
				e.type === "file" &&
				e.name.endsWith(".yaml") &&
				e.name !== "kustomization.yaml",
		)
		.map((e) => ({ name: e.name, path: e.path, sha: e.sha }));
}

async function readUniverseFile(
	octokit: Octokit,
	path: string,
): Promise<string> {
	const res = await octokit.rest.repos.getContent({
		owner: UNIVERSE_OWNER,
		repo: UNIVERSE_REPO,
		path,
		ref: UNIVERSE_BRANCH,
	});
	const data = res.data as { content?: string; encoding?: string };
	if (typeof data.content !== "string") {
		throw new Error(`no file content returned for ${path}`);
	}
	const encoding = data.encoding === "base64" ? "base64" : "utf8";
	return Buffer.from(data.content, encoding).toString("utf8");
}

/**
 * The production source: universe files over the platform's App-authenticated
 * Octokit, applied via the shared `applyServiceCR` primitive.
 */
export function defaultSource(): DeclaredCRsSource {
	const octokit = appEnvOctokit();
	return {
		list: () => listUniverseCRs(octokit),
		read: (path) => readUniverseFile(octokit, path),
		apply: (cr, opts) => applyServiceCR(cr, opts),
	};
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Parse a CR file (multi-doc tolerant) into CR objects; drops malformed docs. */
export function parseCRs(text: string): ParsedCR[] {
	const out: ParsedCR[] = [];
	for (const doc of parseAllDocuments(text)) {
		if (doc.errors.length > 0) continue;
		const obj = doc.toJSON();
		if (obj && typeof obj === "object") out.push(obj as ParsedCR);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Apply pass
// ---------------------------------------------------------------------------

/** Structured outcome of one apply pass. */
export interface ApplySummary {
	/** Names of CRs applied (created or updated) this pass. */
	applied: string[];
	/** Parsed CRs seen but not in the reconcilable set (this pass). */
	skipped: number;
	/** Per-CR failures — one failure never aborts the rest. */
	failed: Array<{ name: string; error: string }>;
	/** True when no file changed since the last successful pass (fast path). */
	unchanged: boolean;
}

function errMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	const e = err as { message?: string };
	return e?.message ?? String(err);
}

/**
 * Module-level "last successfully-applied blob sha" per file path. Lets the
 * scheduler tick skip re-fetching + re-applying files whose git version is
 * unchanged, so steady state is one directory-listing call and zero applies.
 * Reset on pod restart (→ a full re-apply), so the cluster re-converges to git.
 */
const appliedSha = new Map<string, string>();

/**
 * Fetch the declared `Service` CRs from universe and apply the reconcilable
 * subset. Incremental (only changed files), idempotent, best-effort per-CR,
 * never prunes. Returns a structured summary; never throws for a per-CR failure
 * (only a `source.list()` failure — e.g. GitHub unreachable — propagates, so the
 * caller/scheduler can log it).
 *
 * `source` and `cache` are injectable for tests; production uses the universe
 * Octokit source and the shared module cache.
 */
export async function applyDeclaredCRs(
	source: DeclaredCRsSource = defaultSource(),
	cache: Map<string, string> = appliedSha,
): Promise<ApplySummary> {
	const files = await source.list();
	const summary: ApplySummary = {
		applied: [],
		skipped: 0,
		failed: [],
		unchanged: true,
	};

	for (const file of files) {
		// Unchanged since the last SUCCESSFUL handling — the operator keeps the
		// Deployment reconciled from the already-applied CR; nothing to push.
		if (cache.get(file.path) === file.sha) continue;
		summary.unchanged = false;

		let crs: ParsedCR[];
		try {
			crs = parseCRs(await source.read(file.path));
		} catch (err) {
			summary.failed.push({ name: file.name, error: errMessage(err) });
			continue; // don't cache the sha → retried next tick
		}

		let fileOk = true;
		for (const cr of crs) {
			if (!isReconcilable(cr)) {
				summary.skipped += 1;
				continue;
			}
			const name = cr.metadata?.name as string;
			try {
				await source.apply(
					cr as unknown as CustomResource<OperatorServiceSpec>,
				);
				summary.applied.push(name);
			} catch (err) {
				summary.failed.push({ name, error: errMessage(err) });
				fileOk = false; // retry this file next tick
			}
		}

		// Record the sha only when the file's version was fully handled without a
		// failure, so a transient apply error is retried on the next pass.
		if (fileOk) cache.set(file.path, file.sha);
	}

	return summary;
}
