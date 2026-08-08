/**
 * promote — a successful build becomes a DECLARED image, or it becomes nothing.
 *
 * This is the slot the deploy-executor used to hold, and the mechanism is the
 * whole change. The executor merge-patched the operator CR's `.spec.image` the
 * instant a build compiled: no verification, no record, and the running state
 * moved while git kept saying something else. Its own successor stage admitted
 * the shape of it — the e2e leg "runs against the LIVE service, so it only fires
 * after a real rollout" — which is a test that reports what already happened.
 *
 * The order is now the order of increasing commitment:
 *
 *   BUILT  →  SMOKE  →  PIN  →  (cd.hanzo.ai reconciles, out of band)
 *
 * and every arrow is a place to stop. A build that compiles and panics at init
 * fails the smoke and is never written down. A refusal, an unreadable digest, a
 * forge that will not answer — each returns a terminal state and commits nothing.
 * The ONLY path that reaches `promoted` is one that observed the exact bytes
 * reach readiness and then wrote them into universe.
 *
 * FAIL-CLOSED IS THE INVARIANT, AND IT IS STRUCTURAL: nothing here writes to a
 * cluster. Promotion is one commit to one git repo, so the worst a bug can do is
 * fail to deploy. It cannot deploy the wrong thing, because the only thing it
 * knows how to do to production is describe it.
 *
 * This never throws. A promotion that cannot happen must not also cost the build
 * its publish stage — a library repo's release does not depend on a deploy — so
 * every outcome is a value the caller stamps on the row and moves past.
 */

import {
	authorizeNamespace,
	fleetNamespaceOwners,
} from "../k8s/operator/namespace-authz";
import type { BuildJob } from "./build-job";
import { updateBuildJob } from "./build-job";
import { parseImageRef } from "./image-ref";
import { commitPin } from "./pin";
import type { DeployConfig } from "./platform-config";
import { smoke } from "./smoke-runner";

/**
 * Where a build stopped. Stamped verbatim on `buildJob.rolloutStatus`, so the
 * board shows the position rather than a boolean that cannot say why.
 *
 * `promoted` is the only value that means an image was written down. Everything
 * else is terminal WITHOUT a commit — there is no state from which promotion
 * resumes, because a re-run is a new build of the same commit and goes through
 * the same three arrows.
 */
export type PromotionState =
	| "skipped"
	| "smoking"
	| "smoke-failed"
	| "promoted"
	| "failed";

export interface Promotion {
	/** True only when a NEW pin was committed — i.e. CD has something to reconcile. */
	promoted: boolean;
	state: PromotionState;
	/** `<namespace>/<name>` once a target is resolved. */
	target?: string;
	reason: string;
}

/**
 * Smoke the built image and, if it starts, pin it into universe.
 *
 * `deploy.target.namespace` and `.name` arrive verbatim from the built repo's
 * own `hanzo.yml` and are UNTRUSTED; `job.organizationId` comes from the
 * webhook→repo→org binding and is trusted. `authorizeNamespace` is the one place
 * that decides whether this org may speak for that namespace, and it is asked
 * BEFORE anything is started or written.
 */
export async function promoteBuild(
	job: BuildJob,
	deploy: DeployConfig | undefined,
): Promise<Promotion> {
	if (job.status !== "succeeded") {
		return await stamp(job, {
			promoted: false,
			state: "failed",
			reason: `build is ${job.status}, not succeeded`,
		});
	}
	if (!deploy) {
		return await stamp(job, {
			promoted: false,
			state: "skipped",
			reason: "no deploy block in hanzo.yml",
		});
	}
	if (!deploy.on.includes(job.branch)) {
		return await stamp(job, {
			promoted: false,
			state: "skipped",
			reason: `branch ${job.branch} is not a deploy branch (${deploy.on.join(", ")})`,
		});
	}

	const { namespace, name } = deploy.target;
	const target = `${namespace}/${name}`;

	const authz = authorizeNamespace(
		namespace,
		job.organizationId,
		fleetNamespaceOwners(),
	);
	if (authz.decision === "refuse") {
		return await stamp(job, {
			promoted: false,
			state: "failed",
			target,
			reason: `refusing unauthorized promotion: ${authz.reason}`,
		});
	}

	// WHICH BYTES. The build recorded the digest of the manifest it pushed; a tag
	// alone is a mutable name and could already point somewhere else. No digest
	// means the build cannot say what it made, and an image nobody can name is not
	// a thing to smoke or to declare.
	const digest = job.imageDigest;
	if (!digest) {
		return await stamp(job, {
			promoted: false,
			state: "failed",
			target,
			reason:
				"the build recorded no image digest — refusing to promote bytes it cannot name",
		});
	}
	const [repository, tag] = parseImageRef(job.image);
	// The exact reference for both stages: the smoke runs THESE bytes, and the pin
	// declares THESE bytes. One resolution, used twice — the tag and the digest
	// cannot drift apart because neither is looked up a second time.
	const pinned = `${repository}:${tag}@${digest}`;

	await stamp(job, {
		promoted: false,
		state: "smoking",
		target,
		reason: `smoking ${pinned}`,
	});

	try {
		const result = await smoke({ namespace, name, image: pinned, digest });
		if (!result.passed) {
			return await stamp(job, {
				promoted: false,
				state: "smoke-failed",
				target,
				reason: `${pinned} did not start: ${result.reason}`,
			});
		}

		const pin = await commitPin({
			namespace,
			name,
			image: job.image,
			digest,
			buildJobId: job.buildJobId,
		});
		return await stamp(job, {
			// Only a NEW commit gives CD something to reconcile. An unchanged file is
			// already promoted and must not re-arm the stages that follow a rollout.
			promoted: pin.committed,
			state: "promoted",
			target,
			reason: pin.reason,
		});
	} catch (err) {
		// Anything unexpected lands here and lands as `failed`. A promotion path
		// that cannot say what happened has not promoted anything, and saying so is
		// the whole contract.
		return await stamp(job, {
			promoted: false,
			state: "failed",
			target,
			reason: message(err),
		});
	}
}

/** Record the position on the row and hand the same value back to the caller. */
async function stamp(job: BuildJob, p: Promotion): Promise<Promotion> {
	await updateBuildJob(job.buildJobId, {
		rolloutStatus: p.state,
		...(p.target ? { rolloutTarget: p.target } : {}),
		// `skipped` and `smoking` are positions, not problems; only a stop worth
		// reading lands in `error`, and it does not overwrite a build failure
		// because a build that failed never reaches here.
		...(p.state === "failed" || p.state === "smoke-failed"
			? { error: p.reason }
			: {}),
	});
	return p;
}

function message(err: unknown): string {
	const e = err as { message?: string };
	return e?.message ?? String(err);
}
