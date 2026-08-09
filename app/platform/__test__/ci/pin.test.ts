/**
 * pin — the universe promoter.
 *
 * These tests assert the BYTES, not merely "no error thrown". A pin that reports
 * success while writing a reference nothing can pull is the failure mode this
 * suite exists to catch, and it has happened: a tag moved without its digest ran
 * the previous release under the new version's name, green all the way.
 *
 * The fixtures are the real shapes from `hanzoai/universe`
 * `charts/app/values/*​/*.yaml` — including the prose-heavy one, because these
 * files are mostly comments and reflowing them is the other way to be wrong.
 *
 * No forge is contacted: `fetch` is stubbed and every request it receives is
 * recorded, so the commit body is asserted rather than assumed.
 */
import {
	commitPin,
	pin,
	UNIVERSE_BRANCH,
	valuesPath,
} from "@hanzo/platform/services/ci/pin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

const DIGEST_A =
	"sha256:299541e211d92426a7fa6e15790d22c49d04c2930ca10de8bb53134d55a307e7";
const DIGEST_B =
	"sha256:60ca34bd76f3472f8c5b4903c6516686bbdfce696b4569aaa80c1fbac4e3085e";

/** The common shape: tag + digest already present, comments around them. */
const BLOG = `# The blog declaration. Hand-maintained: this file IS the source of truth, read
# by the \`fleet\` ApplicationSet (charts/app/values/*/*.yaml). Edit it directly.
replicas: 2
partOf: platform
component: blog
imagePullSecrets:
- name: ghcr-secret
ports:
- containerPort: 3000
  name: http
  servicePort: 80
image:
  repository: ghcr.io/hanzoai/blog
  tag: 0.1.1
  digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  pullPolicy: IfNotPresent
pdb:
  enabled: true
  maxUnavailable: 1
cd:
  automated: true
`;

/** No digest yet, and an indented comment INSIDE the image block (cloud.yaml's shape). */
const PROSE = `chart: app
replicas: 1
image:
  repository: ghcr.io/hanzoai/cloud
  # WHY THIS TAG. The sha is the commit the release was cut from; moving it is
  # the deploy. Everything below this line is reasoning, and a YAML round-trip
  # would reflow it away.
  #
  #   tag: not-a-key — this line is a comment and must survive untouched
  tag: sha-e50ec914
  pullPolicy: IfNotPresent
startupProbe:
  httpGet:
    path: /readyz
    port: 8080
`;

describe("valuesPath — the inventory is the directory", () => {
	it("maps a namespace and a name onto the file the ApplicationSet globs", () => {
		expect(valuesPath("hanzo", "cloud")).toBe(
			"charts/app/values/hanzo/cloud.yaml",
		);
	});

	it("routes a tenant to its own leased directory, with no special case", () => {
		expect(valuesPath("tenant-acme", "api")).toBe(
			"charts/app/values/tenant-acme/api.yaml",
		);
	});
});

describe("pin — one edit, everything else byte-for-byte", () => {
	it("moves tag and digest together", () => {
		const out = pin(BLOG, "0.1.2", DIGEST_A);
		expect(out).toContain("  tag: 0.1.2\n");
		expect(out).toContain(`  digest: ${DIGEST_A}\n`);
		expect(out).not.toContain("0.1.1");
		expect(out).not.toContain("aaaaaaaa");
	});

	it("changes NOTHING else — every other line is identical", () => {
		const out = pin(BLOG, "0.1.2", DIGEST_A);
		const before = BLOG.split("\n");
		const after = out.split("\n");
		expect(after).toHaveLength(before.length);
		const changed = before
			.map((l, i) => (l === after[i] ? null : i))
			.filter((i): i is number => i !== null);
		// Exactly two lines move: tag and digest.
		expect(changed).toHaveLength(2);
		expect(before[changed[0] as number]?.trim()).toMatch(/^tag:/);
		expect(before[changed[1] as number]?.trim()).toMatch(/^digest:/);
	});

	it("adds a digest beneath the tag, at the tag's indentation, when the file has none", () => {
		const out = pin(PROSE, "sha-abc1234", DIGEST_B);
		expect(out).toContain(`  tag: sha-abc1234\n  digest: ${DIGEST_B}\n`);
	});

	it("leaves a commented `tag:` inside the image block alone", () => {
		const out = pin(PROSE, "sha-abc1234", DIGEST_B);
		expect(out).toContain(
			"  #   tag: not-a-key — this line is a comment and must survive untouched",
		);
		// The real key moved; the comment did not become the key.
		expect(out).not.toContain("tag: sha-e50ec914");
	});

	it("preserves the prose around the image block verbatim", () => {
		const out = pin(PROSE, "sha-abc1234", DIGEST_B);
		expect(out).toContain(
			"  # WHY THIS TAG. The sha is the commit the release was cut from; moving it is",
		);
		expect(out).toContain("startupProbe:\n  httpGet:\n    path: /readyz");
	});

	it("does not touch an `image:` key nested under another block", () => {
		const nested = `initContainers:
- name: wait
  image: busybox:1.36
image:
  repository: ghcr.io/hanzoai/blog
  tag: 0.1.1
`;
		const out = pin(nested, "0.1.2", DIGEST_A);
		expect(out).toContain("  image: busybox:1.36");
		expect(out).toContain("  tag: 0.1.2");
	});

	it("is idempotent — pinning the same pair twice yields identical bytes", () => {
		const once = pin(BLOG, "0.1.2", DIGEST_A);
		expect(pin(once, "0.1.2", DIGEST_A)).toBe(once);
	});

	it("never emits a reference with two digests (the chart renders repo:tag@digest)", () => {
		// The hazard the sibling-key form exists to prevent: a digest smuggled into
		// the tag would render `repo:v1@sha256:NEW@sha256:OLD` and pull nothing.
		const out = pin(BLOG, "0.1.2", DIGEST_A);
		expect(out).not.toMatch(/tag:.*@sha256:/);
	});

	it("writes tag and digest as SIBLING keys at one indentation", () => {
		// The whole reason the chart can render `repo:tag@digest`. Asserted on the
		// parsed document, so a digest appended to the tag's own scalar — which
		// reads plausibly as text — cannot satisfy it.
		const doc = parseYaml(pin(BLOG, "0.1.2", DIGEST_A)) as {
			image: Record<string, unknown>;
		};
		expect(doc.image.tag).toBe("0.1.2");
		expect(doc.image.digest).toBe(DIGEST_A);
		expect(doc.image.repository).toBe("ghcr.io/hanzoai/blog");
	});

	it("quotes a tag YAML would otherwise read as a number", () => {
		// `image-prepull` really declares `tag: "1.36"` and `kv` really declares
		// `tag: '9'`. The chart's schema says image.tag is a STRING, so dropping
		// the quotes with the value makes the release fail to render.
		const numeric = `image:
  repository: ghcr.io/hanzoai/kv
  tag: '9'
  digest: ${DIGEST_A}
`;
		const out = pin(numeric, "18", DIGEST_B);
		const doc = parseYaml(out) as { image: Record<string, unknown> };
		expect(doc.image.tag).toBe("18");
		expect(typeof doc.image.tag).toBe("string");
	});

	it("leaves a tag that needs no quotes bare, like the rest of the fleet", () => {
		expect(pin(BLOG, "v1.2.3", DIGEST_A)).toContain("  tag: v1.2.3\n");
		expect(pin(BLOG, "sha-e50ec914", DIGEST_A)).toContain(
			"  tag: sha-e50ec914\n",
		);
	});
});

// --- commitPin: the forge round trip -----------------------------------------

interface Recorded {
	url: string;
	method: string;
	body?: Record<string, unknown>;
}

const calls: Recorded[] = [];
let fileContent = BLOG;
let getStatus = 200;
let putStatus = 200;

function stubFetch() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET";
			const body = init?.body
				? (JSON.parse(init.body as string) as Record<string, unknown>)
				: undefined;
			calls.push({ url, method, body });
			if (method === "GET") {
				if (getStatus !== 200) {
					return new Response("nope", { status: getStatus });
				}
				return Response.json({
					content: Buffer.from(fileContent, "utf8").toString("base64"),
					sha: "blob-sha-1",
				});
			}
			if (putStatus !== 200) {
				return new Response("conflict", { status: putStatus });
			}
			return Response.json({ commit: { sha: "commit-sha-1" } });
		}),
	);
}

beforeEach(() => {
	calls.length = 0;
	fileContent = BLOG;
	getStatus = 200;
	putStatus = 200;
	process.env.HANZO_GIT_URL = "https://git.hanzo.ai";
	process.env.HANZO_GIT_TOKEN = "forge-token";
	process.env.HANZO_GIT_WEBHOOK_SECRET = "hook";
	process.env.HANZO_GIT_ORGANIZATION_ID = "Yb5GFGDBEwcLsv2O8qWjS";
	stubFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const input = {
	namespace: "hanzo",
	name: "blog",
	image: "ghcr.io/hanzoai/blog:0.1.2",
	digest: DIGEST_A,
	buildJobId: "bj_test",
};

describe("commitPin — the commit is the deploy", () => {
	it("commits the new tag + digest to the values file on main", async () => {
		const res = await commitPin(input);

		expect(res.committed).toBe(true);
		expect(res.path).toBe("charts/app/values/hanzo/blog.yaml");
		expect(res.commit).toBe("commit-sha-1");

		const put = calls.find((c) => c.method === "PUT");
		expect(put?.url).toBe(
			"https://git.hanzo.ai/v1/repos/hanzo/universe/contents/charts/app/values/hanzo/blog.yaml",
		);
		expect(put?.body?.branch).toBe(UNIVERSE_BRANCH);
		// The blob sha we read: a concurrent commit must make this write fail, not
		// silently overwrite a pin somebody else just moved.
		expect(put?.body?.sha).toBe("blob-sha-1");

		const written = Buffer.from(
			put?.body?.content as string,
			"base64",
		).toString("utf8");
		expect(written).toContain("  tag: 0.1.2");
		expect(written).toContain(`  digest: ${DIGEST_A}`);
		// Everything else survived the round trip.
		expect(written).toContain("cd:\n  automated: true");
	});

	it("reaches the forge at /v1, never /api/v1", async () => {
		await commitPin(input);
		for (const c of calls) {
			expect(c.url).toContain("/v1/repos/");
			expect(c.url).not.toContain("/api/v1/");
		}
	});

	it("stamps a Pinned-by trailer naming the build, like pin.sh does", async () => {
		await commitPin(input);
		const put = calls.find((c) => c.method === "PUT");
		expect(put?.body?.message).toContain("Pinned-by: platform build bj_test");
		expect(put?.body?.message).toContain("blog 0.1.1 -> 0.1.2");
	});

	it("is idempotent: an unchanged file makes NO commit", async () => {
		fileContent = pin(BLOG, "0.1.2", DIGEST_A);
		const res = await commitPin(input);
		expect(res.committed).toBe(false);
		expect(calls.some((c) => c.method === "PUT")).toBe(false);
	});

	it("corrects a file whose tag is current but whose digest is stale", async () => {
		// The failure that succeeds at doing nothing — the pod reports the new
		// version and runs the old bytes. A byte comparison catches it; comparing
		// tags would not.
		fileContent = BLOG.replace("tag: 0.1.1", "tag: 0.1.2");
		const res = await commitPin(input);
		expect(res.committed).toBe(true);
	});
});

describe("commitPin — what it refuses, each without writing anything", () => {
	const noPut = () => expect(calls.some((c) => c.method === "PUT")).toBe(false);

	it("refuses a repository the caller chose, not the one the file declares", async () => {
		await expect(
			commitPin({ ...input, image: "ghcr.io/hanzoai/evil:0.1.2" }),
		).rejects.toThrow(/refusing to repoint a service at a different image/);
		noPut();
	});

	it("refuses to invent a service when the values file does not exist", async () => {
		getStatus = 404;
		await expect(commitPin(input)).rejects.toThrow(
			/a service is added deliberately, not by a build/,
		);
		noPut();
	});

	it("refuses a digest that is not a manifest digest", async () => {
		await expect(
			commitPin({ ...input, digest: "sha256:short" }),
		).rejects.toThrow(/not a manifest digest/);
		noPut();
	});

	it("refuses an empty digest — an unnamed build is not promotable", async () => {
		await expect(commitPin({ ...input, digest: "" })).rejects.toThrow(
			/not a manifest digest/,
		);
		noPut();
	});

	it("refuses a tag it cannot write as a bare YAML scalar", async () => {
		await expect(
			commitPin({ ...input, image: "ghcr.io/hanzoai/blog:has space" }),
		).rejects.toThrow(/no tag this can write/);
		noPut();
	});

	it("refuses when the forge token is unset — it cannot commit anonymously", async () => {
		process.env.HANZO_GIT_TOKEN = "";
		await expect(commitPin(input)).rejects.toThrow(/HANZO_GIT_TOKEN is unset/);
		noPut();
	});

	it("refuses a declaration that owns no workload", async () => {
		fileContent = "hosts:\n- blog.hanzo.ai\n";
		await expect(commitPin(input)).rejects.toThrow(/declares no image: block/);
		noPut();
	});

	it("refuses a values file with no tag to move", async () => {
		fileContent = "image:\n  repository: ghcr.io/hanzoai/blog\n";
		await expect(commitPin(input)).rejects.toThrow(/declares no image.tag/);
		noPut();
	});

	it("surfaces a rejected write rather than reporting a pin that did not land", async () => {
		putStatus = 409;
		await expect(commitPin(input)).rejects.toThrow(/returned 409/);
	});
});
