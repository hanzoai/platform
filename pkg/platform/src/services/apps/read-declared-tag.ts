/**
 * read_declared_tag — scrape the universe operator CRs, write `apps.declared_tag`.
 *
 * Contract: `docs/APPS_LIFECYCLE.md` §"read_declared_tag — scrapes universe
 * manifests, writes declared_tag" and §"Declared state is the source of truth …
 * a row in the apps table that points to a vX.Y.Z git tag. Manifests … derive
 * from that row." The declared tag is whatever the operator CR says to run —
 * recorded VERBATIM (a floating `:multi-issuer` is stored as-is so the drift
 * checker flags it; this reader observes, it never normalizes).
 *
 * Source: `hanzoai/universe` → `infra/k8s/operator/crs/*-v1.yaml`. The canonical
 * operator CRs are exactly the `*-v1.yaml` files carrying `apiVersion:
 * hanzo.ai/v1`; the sibling `*.yaml` (`v1alpha1`) files are legacy raw manifests
 * and are ignored. Matching is by image **repository** (`spec.image.repository
 * == apps.registry`), not by `metadata.name`, because one image (e.g.
 * `ghcr.io/hanzoai/cloud`) is fronted by a CR whose name differs from the app
 * (`cloud-api`). The apps row already carries `registry`, so that's the join key.
 */

import { parse } from "yaml";
import { logger } from "../../lib/logger";
import { allApps, appsReaderOctokit, upsertObserved } from "./shared";

/** Where the operator CRs live in the universe repo. */
const UNIVERSE_OWNER = "hanzoai";
const UNIVERSE_REPO = "universe";
const CR_DIR = "infra/k8s/operator/crs";
const UNIVERSE_REF = process.env.UNIVERSE_REF || "main";

/** Minimal shape we read out of a `hanzo.ai/v1` operator CR. */
type OperatorCR = {
	apiVersion?: string;
	spec?: { image?: { repository?: string; tag?: string } };
};

/** GH contents-API entry for a directory listing. */
type ContentEntry = { name: string; path: string; type: string };

/**
 * Fetch + parse every operator CR, returning a `repository → declared tag`
 * map. Only `*-v1.yaml` files with `apiVersion: hanzo.ai/v1` and a
 * `spec.image.{repository,tag}` contribute. Throws on a listing failure (the
 * whole sweep is meaningless without the CR set); tolerates a single bad file.
 */
async function declaredTagsByRepository(
	octokit: ReturnType<typeof appsReaderOctokit>,
): Promise<Map<string, string>> {
	const listing = await octokit.rest.repos.getContent({
		owner: UNIVERSE_OWNER,
		repo: UNIVERSE_REPO,
		path: CR_DIR,
		ref: UNIVERSE_REF,
	});

	const entries = listing.data as unknown as ContentEntry[];
	if (!Array.isArray(entries)) {
		throw new Error(`${CR_DIR} is not a directory`);
	}

	const crFiles = entries.filter(
		(e) => e.type === "file" && e.name.endsWith("-v1.yaml"),
	);

	const byRepo = new Map<string, string>();
	for (const file of crFiles) {
		try {
			const res = await octokit.rest.repos.getContent({
				owner: UNIVERSE_OWNER,
				repo: UNIVERSE_REPO,
				path: file.path,
				ref: UNIVERSE_REF,
			});
			const data = res.data as { content?: string; encoding?: string };
			if (!data.content) continue;
			const yamlText = Buffer.from(
				data.content,
				(data.encoding as BufferEncoding) || "base64",
			).toString("utf8");

			const cr = parse(yamlText) as OperatorCR | null;
			if (!cr || cr.apiVersion !== "hanzo.ai/v1") continue;

			const repository = cr.spec?.image?.repository;
			const tag = cr.spec?.image?.tag;
			if (!repository || tag === undefined || tag === null) continue;
			// First CR wins per repository; the `-v1.yaml` set is the canonical
			// declared source and is expected to be 1:1 with an image.
			if (!byRepo.has(repository)) byRepo.set(repository, String(tag));
		} catch (err) {
			logger.warn(
				{ file: file.path, err: (err as Error).message },
				"[read_declared_tag] CR fetch/parse failed, skipping",
			);
		}
	}
	return byRepo;
}

/**
 * Run one sweep: read the operator CRs and write each app's `declared_tag`
 * verbatim from the CR whose `spec.image.repository` matches the app's
 * registry. Apps with no matching CR are left untouched (their declared_tag
 * keeps whatever the seed set — often null for control-plane apps).
 */
export async function readDeclaredTag(): Promise<{
	scanned: number;
	updated: number;
}> {
	const octokit = appsReaderOctokit();
	const byRepo = await declaredTagsByRepository(octokit);
	const rows = await allApps();
	let updated = 0;

	for (const row of rows) {
		const declared = byRepo.get(row.registry);
		if (declared === undefined) {
			logger.info(
				{ id: row.id, registry: row.registry },
				"[read_declared_tag] no operator CR for registry, leaving as-is",
			);
			continue;
		}
		const n = await upsertObserved(row.id, { declaredTag: declared });
		if (n > 0) updated += 1;
	}

	logger.info(
		{ scanned: rows.length, crs: byRepo.size, updated },
		"[read_declared_tag] sweep done",
	);
	return { scanned: rows.length, updated };
}
