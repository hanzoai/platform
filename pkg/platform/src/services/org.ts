/**
 * Which organization a name belongs to.
 *
 * A repository is `owner/name` and an image is `<registry>/<namespace>/<name>`.
 * The owner and the namespace are the same kind of name — one organization,
 * spelled by whoever is doing the spelling — and this is where that is written
 * down. Once: the principal a build acts as, the destination it may publish to,
 * and the credential it mounts to get there all read it here.
 *
 * The last hop is already in the database. `organization.slug` holds the IAM org
 * name and is unique, so a name resolves to a row without a second table of ids
 * to keep in step. That split is the point: which names an organization owns is
 * a fact about the estate and is stated here; which row that organization is, is
 * a fact about this install and is stated by the database.
 *
 * Declared as what each organization OWNS and read through the inverse, so an
 * organization states its own names in one place and no name is claimed twice.
 *
 * Not the runner pool. `runnerPoolFor` maps an owner to the ARC scale set its
 * builds run ON, which is capacity and can be borrowed — `bootnode` builds on
 * Hanzo's pool without being Hanzo. Sharing a pool is not owning a namespace, so
 * the two tables stay apart.
 */
import { db } from "@hanzo/platform/db";
import { organization } from "@hanzo/platform/db/schema";
import { eq } from "drizzle-orm";
import { imageHost, imageOrg, parseImageRef } from "./ci/image-ref";

/**
 * The names each organization publishes under.
 *
 * A forge owner and a registry namespace share this space: `hanzo/kms` and
 * `hanzoai/kms` are two repositories of one organization, and both publish
 * `ghcr.io/hanzoai/kms`. An organization spells itself several ways — `hanzoai`
 * on the registry, `hanzo-apps` and `hanzo-docs` on the forge — and every one of
 * them is the same organization.
 *
 * A namespace belongs here when a `push-<namespace>` credential exists for it in
 * `hanzo-build`: that credential is what a build in this namespace is handed, so
 * this table is what decides who may ask for it. A namespace with no credential
 * is left out, and a build that names one is refused for want of a credential
 * rather than admitted and left waiting on a Secret that was never provisioned.
 *
 * Adding a brand is one line here plus its `push-<namespace>` KMS path plus an
 * `organization` row carrying its slug — the three facts that make an
 * organization publishable. Until the row exists its builds are refused by name,
 * which is loud and says what to do; a name absent from this table belongs to
 * nobody here, which is also a refusal, never a default.
 */
const OWNS: Readonly<Record<string, readonly string[]>> = {
	hanzo: [
		"hanzo",
		"hanzoai",
		"hanzo-apps",
		"hanzo-docs",
		"hanzo-inc",
		"hanzoteam",
	],
	lux: ["lux", "luxfi"],
	zoo: ["zoo", "zooai"],
	pars: ["pars", "parsdao"],
};

/**
 * Name → organization: {@link OWNS} inverted once, at load.
 *
 * Null prototype, so a name like `__proto__` is an ordinary entry rather than a
 * reference to something inherited. Two organizations claiming one name is a
 * contradiction in the table itself and stops the process — it cannot be
 * resolved at read time, because both answers are wrong.
 */
const OF: Readonly<Record<string, string>> = Object.freeze(
	Object.entries(OWNS).reduce<Record<string, string>>((of, [owner, names]) => {
		for (const name of names) {
			if (name !== name.toLowerCase()) {
				throw new Error(`services/org: "${name}" must be spelled lowercase`);
			}
			const held = of[name];
			if (held) {
				throw new Error(
					`services/org: "${name}" is claimed by both ${held} and ${owner}`,
				);
			}
			of[name] = owner;
		}
		return of;
	}, Object.create(null)),
);

/**
 * The organization a forge owner or registry namespace belongs to, or undefined
 * when it belongs to none of them.
 *
 * Closed, and undefined rather than the name itself. A name that resolves to
 * itself makes registering a name the same thing as owning what it spells, and
 * the forge hands out names on request.
 *
 * Case is folded HERE, and only here. The forge and the registry both resolve a
 * name without regard to case, so `HanzoAI` and `hanzoai` address one thing and
 * every reader of this table has to agree about which. Folding once, at the one
 * lookup, is what keeps a rule and the credential it guards from disagreeing
 * about whose image an image is.
 */
export function org(name: string): string | undefined {
	return OF[name.toLowerCase()];
}

/**
 * The organization ROW a name resolves to, or null when there is none.
 *
 * Two ways to have no answer, and both are null: the name belongs to no
 * organization, or the organization it belongs to has no row on this install.
 * Neither is a principal, and a build with no principal is refused rather than
 * given a default one.
 *
 * The slug comparison is exact. Slugs are IAM org names, `Hanzo` is a different
 * tenant from `hanzo`, and folding one side of a comparison between principals
 * is not a normalization — it is a collision, and here the collision would be a
 * grant.
 */
export async function orgId(name: string): Promise<string | null> {
	const slug = org(name);
	if (!slug) return null;
	const row = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.slug, slug))
		.limit(1)
		.then((rows) => rows[0]);
	return row?.id ?? null;
}

/**
 * Owner segment of a repository path — the organization's name on the forge.
 *
 * A repository is `owner/name`, and `repoProblem` has said so before anything
 * reaches here. A value with no owner segment is a broken caller rather than a
 * bad request, and it says so out loud, because both quiet answers are worse
 * than an exception: the whole string is a NAME, and `hanzoaix` would resolve to
 * Hanzo and be allowed to publish Hanzo's images; the empty string names a
 * runner pool no runner answers to, and the build waits forever instead of
 * failing. Total, so every reader below can treat its answer as a real owner.
 */
export function ownerOf(repo: string): string {
	const slash = repo.indexOf("/");
	if (slash <= 0) {
		throw new Error(
			`"${repo}" does not name a repository: expected owner/name`,
		);
	}
	return repo.slice(0, slash);
}

/**
 * The registries this fabric publishes to.
 *
 * Owning a namespace says where an image belongs; it does not say where it may
 * be written. Both halves name one destination, so both are decided here rather
 * than leaving a build free to ask for its own credential and a registry we do
 * not run. `oci.hanzo.ai` is the one name our own OCI registry answers to — the
 * S3-backed store behind Hanzo IAM token auth — and ghcr.io is the public
 * mirror. Two names, two stores, and a host is on this list only while it
 * serves one: an allowance that outlives the service it named is an allowance
 * nothing reviews.
 *
 * Spelled exactly. A port is part of a host string, so `ghcr.io:443` is a
 * different spelling than anything here writes and is not one of these.
 */
const HOSTS: ReadonlySet<string> = new Set(["ghcr.io", "oci.hanzo.ai"]);

/**
 * Returns what is wrong with a registry host, or null when it is one this
 * fabric publishes to.
 *
 * There are two ways to name a host a build writes to — the destination on the
 * row, and a fabric-wide one every build also pushes to — and one set of
 * registries we run. Both read it through here, so a host allowed as one is
 * allowed as the other and there is no second list to drift.
 */
export function registryProblem(host: string): string | null {
	return HOSTS.has(host.toLowerCase())
		? null
		: `"${host}" is not a registry this fabric publishes to (${[...HOSTS].join(", ")})`;
}

/**
 * The alphabet an image reference is drawn from: letters, digits and `._-/:@`.
 *
 * A destination is written into ONE comma-separated field of the image exporter
 * the build muscle runs, so this is what keeps a reference one field: a comma
 * would open a second, and an `=` would make it an attribute of the exporter
 * rather than part of a name.
 */
const REF = /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/;

/**
 * A build publishes into its own organization's namespace, on a registry we run.
 *
 * The destination is DECLARED — by the repository's own `hanzo.yml`, or by
 * whoever called the direct door — and it is what {@link pushSecret} derives a
 * credential from. So the three are bound: the destination is one image
 * reference, it addresses one of {@link HOSTS}, and the namespace it publishes
 * into belongs to the same organization as the owner of the repository that
 * declared it.
 *
 * A namespace no organization here owns is not judged. No credential of ours
 * reaches it and nothing of ours publishes there, so it is somebody else's
 * registry.
 *
 * Returns what is wrong with the destination, or null when the repository may
 * publish it. Same shape as the other build-request rules, so a front door
 * answers 400 with the message and the build path refuses on the same call.
 */
export function destinationProblem(repo: string, image: string): string | null {
	const ns = imageOrg(image);
	if (!ns) return null;
	const owner = org(ns);
	if (!owner) return null;
	const refusing = `Refusing to build ${image} from ${repo}`;
	if (!REF.test(image)) {
		return (
			`${refusing}: a destination is ONE image reference — ` +
			"<registry>/<namespace>/<name>[:tag][@digest], spelled with letters, " +
			"digits and ._-/:@ — and this is not one."
		);
	}
	const registry = registryProblem(imageHost(image) ?? "");
	if (registry) {
		return `${refusing}: ${registry}, and ${owner}'s images are published on ours.`;
	}
	if (org(ownerOf(repo)) === owner) return null;
	return (
		`${refusing}: the "${ns}" namespace carries ` +
		`${owner}'s images, and ${repo} is not one of ${owner}'s repositories.`
	);
}

/**
 * The Kubernetes Secret a repository's build mounts to publish an image.
 *
 * Registries NEVER mix: a build mounts `push-<namespace>` and only that, so a
 * token reachable from a Hanzo build cannot push to `ghcr.io/luxfi`. One secret
 * per namespace is the whole isolation mechanism (hanzoai/universe
 * infra/k8s/hanzo-build).
 *
 * Takes BOTH names, because the credential follows from both. Deriving it from
 * the destination alone answers "which token does this image need"; the question
 * a build path has to answer is "which token may this repository be handed", and
 * only one of those can be asked with a single argument. There is no way to
 * spell the first question here.
 *
 * Named only for a namespace {@link OWNS} claims, so the table decides the
 * credential rather than the image string does. That is what keeps a namespace
 * missing from the table a refusal instead of a grant: an unlisted name yields
 * no secret, even where a `push-<name>` Secret happens to exist in the cluster.
 *
 * Returns undefined when no credential belongs to this build — the caller
 * refuses rather than mounting a token.
 */
export function pushSecret(repo: string, image: string): string | undefined {
	const ns = imageOrg(image);
	if (!ns || !org(ns)) return undefined;
	if (destinationProblem(repo, image)) return undefined;
	return `push-${ns.toLowerCase()}`;
}

/**
 * An image in a namespace we publish under.
 *
 * The tag rule applies to these and to nothing else, and they are exactly the
 * images `pushSecret` hands out a credential for — read through the same
 * `imageOrg` and the same table, so a rule cannot accept a spelling the
 * credential rejects, or the other way round.
 */
export function firstParty(image: string): boolean {
	const ns = imageOrg(image);
	return ns !== undefined && org(ns) !== undefined;
}

/**
 * A version: a whole line, from the leading `v` a git tag carries to whatever
 * semver allows after the core — a fourth part for the calendar-versioned
 * upstreams, a pre-release, an arch.
 *
 * WHOLE, because a tag is judged by what it IS and not by what it happens to
 * contain. Read as a substring, `release-1.2.3`, `latest-1.0.0` and `main-0.0.0`
 * are all versions, and each is a name something else can move: the version
 * inside is decoration on a mutable name, not the name.
 *
 * `1.2.3-latest` is a version and passes, and that is the right answer. The only
 * thing that spells one on a push is `{{git.tag}}`, which resolves on the push
 * that MAKES the tag and on no other; a git tag holds still whatever it says.
 */
const VERSION = /^v?\d+\.\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z][0-9A-Za-z.-]*)?$/;
/** Hex, lowercase as git writes it, long enough to name a commit and no longer. */
const HEX = /^[0-9a-f]{7,64}$/;
/**
 * Where one name ends and the next begins inside a tag.
 *
 * A commit tag is the object id plus decoration the repo declares around it —
 * `sha-<id>`, `<id>-amd64-api`, `lux-<id>` are all live in the fleet — so the
 * id is one PART of the tag rather than the whole of it.
 */
const PARTS = /[-_.]/;

/**
 * The name a first-party image publishes under names ONE build — THIS one.
 *
 * A tag is how a running binary is traced back to the source that made it, so it
 * has to hold on to something: a version, or the commit the build read. Each
 * names one set of bytes for good. `latest`, a branch name and a bare major are
 * names that move, and a deploy under a name that moves is one nobody can find
 * their way back from — the image in production and the image that was released
 * stop being the same question.
 *
 * Takes the commit, so a commit-shaped tag has to be THAT commit's. Hex that
 * merely looks like an object id names some other build or none at all, and
 * `deadbeef` reads as a word a person chose. Given the sha, the same rule that
 * admits `sha-7c50638eb180` on the build of `7c50638eb180…` refuses it on every
 * other, so a tag cannot claim a provenance the row does not carry.
 *
 * ONE rule for every door. What a caller may state at the direct enqueue and
 * what a repository's `tag-pattern` may produce on a push are the same question,
 * so a service that answered them differently was refusing at one door exactly
 * what it published at another.
 *
 * A destination is a TAG. A digest is what a registry answers with after a push,
 * not something a push can ask for, so a digest on a destination decides nothing
 * and hides the tag that does — `:latest@sha256:…` publishes `latest`. Images in
 * namespaces we do not publish under are not judged; their tags are their
 * publishers' business.
 *
 * Returns what is wrong with the name, or null when it names this build.
 */
export function tagProblem(image: string, sha: string): string | null {
	if (!firstParty(image)) return null;
	const [, tag] = parseImageRef(image);
	const refusing = `Refusing to build ${image}`;
	if (!tag) {
		return (
			`${refusing}: no tag. An untagged push publishes as ":latest" — ` +
			"give it a version (vX.Y.Z) or the commit it was built from."
		);
	}
	if (VERSION.test(tag)) return null;
	const commit = sha.toLowerCase();
	const names = tag
		.toLowerCase()
		.split(PARTS)
		.some((part) => HEX.test(part) && commit.startsWith(part));
	if (names) return null;
	return (
		`${refusing}: "${tag}" does not name this build. A first-party tag carries a ` +
		`version (vX.Y.Z) or the commit it was built from (${sha.slice(0, 12)}), because ` +
		"those name one set of bytes for good. A name that moves leaves what production " +
		"runs and what was released as two different questions."
	);
}
