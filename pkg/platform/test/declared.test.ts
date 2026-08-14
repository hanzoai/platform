import { describe, expect, it } from "vitest";
import {
	declaredFromValues,
	declaredRefOf,
	rawUrl,
	readDeclared,
} from "../src/services/apps/declared";

// The real shape, copied off lux-mainnet-explorer: the file is named by the
// CHART source and lives in the VALUES source, so neither alone is enough.
const explorer = {
	metadata: { name: "lux-mainnet-explorer" },
	spec: {
		sources: [
			{
				chart: "app",
				repoURL: "oci.hanzo.ai/charts",
				targetRevision: "0.1.11",
				helm: {
					releaseName: "explorer",
					valueFiles: ["$values/deploy/lux-mainnet/explorer.yaml"],
				},
			},
			{
				ref: "values",
				repoURL: "https://git.hanzo.ai/lux/universe",
				targetRevision: "main",
			},
		],
	},
};

describe("declaredRefOf", () => {
	it("joins the chart's file to the values source's repo", () => {
		expect(declaredRefOf(explorer)).toEqual({
			repoURL: "https://git.hanzo.ai/lux/universe",
			revision: "main",
			file: "deploy/lux-mainnet/explorer.yaml",
		});
	});

	it("reads no repo when the values ref is named something else", () => {
		const odd = {
			...explorer,
			spec: {
				sources: [
					explorer.spec.sources[0],
					{ ref: "other", repoURL: "https://git.hanzo.ai/lux/universe" },
				],
			},
		};
		expect(declaredRefOf(odd)).toBeNull();
	});

	it("is null for an app with no values file", () => {
		expect(
			declaredRefOf({ metadata: { name: "x" }, spec: { source: { chart: "app" } } }),
		).toBeNull();
	});
});

describe("rawUrl", () => {
	it("builds the branch form", () => {
		expect(rawUrl(declaredRefOf(explorer)!)).toBe(
			"https://git.hanzo.ai/lux/universe/raw/branch/main/deploy/lux-mainnet/explorer.yaml",
		);
	});

	// A sha needs /raw/commit/, and the branch form would 404 — which reads
	// exactly like a file that is not there.
	it("refuses a commit sha rather than building a URL that 404s", () => {
		expect(
			rawUrl({ repoURL: "https://git.hanzo.ai/lux/universe", revision: "a9e1334", file: "x.yaml" }),
		).toBeNull();
	});
});

describe("declaredFromValues", () => {
	const values = `cd:
  automated: true
replicas: 2
image:
  repository: ghcr.io/luxfi/explorer
  tag: 1.5.47
  digest: sha256:5a6ae6dd
  pullPolicy: IfNotPresent
labels:
  tag: not-the-image-tag
`;
	it("takes the tag from the image block", () => {
		expect(declaredFromValues(values)).toEqual({
			repository: "ghcr.io/luxfi/explorer",
			tag: "1.5.47",
		});
	});

	it("stops at the end of the block, so a later tag: is not read", () => {
		expect(declaredFromValues(values)?.tag).not.toBe("not-the-image-tag");
	});

	it("is null for a file with no image block", () => {
		expect(declaredFromValues("replicas: 2\n")).toBeNull();
	});
});

describe("readDeclared", () => {
	it("reads each file once for every app that shares it", async () => {
		const seen: string[] = [];
		const second = {
			metadata: { name: "lux-mainnet-explorer-2" },
			spec: explorer.spec,
		};
		const out = await readDeclared([explorer, second], async (u) => {
			seen.push(u);
			return "image:\n  tag: 1.5.47\n";
		});
		expect(seen).toHaveLength(1);
		expect(out.get("lux-mainnet-explorer")).toBe("1.5.47");
		expect(out.get("lux-mainnet-explorer-2")).toBe("1.5.47");
	});

	// A forge that fails to answer must not be recorded as "declares nothing":
	// writing null would erase a true declared tag on a transient failure.
	it("omits an app whose file could not be read", async () => {
		const out = await readDeclared([explorer], async () => null);
		expect(out.has("lux-mainnet-explorer")).toBe(false);
	});
});

// A universe is private. Unauthenticated the forge 303s to its login page, and
// a followed redirect lands on a 200 full of HTML — which parses as "no image
// block" and would report the whole fleet as declaring nothing. That is the
// same null-for-everything this module exists to remove, reached from the other
// side and indistinguishable from it.
describe("a login page is not a values file", () => {
	it("parses to nothing rather than to a tag", () => {
		expect(
			declaredFromValues('<a href="/user/login?redirect_to=%2Flux%2Funiverse">Found</a>'),
		).toBeNull();
	});

	it("leaves the app absent, not declared-null", async () => {
		const app = {
			metadata: { name: "a" },
			spec: {
				sources: [
					{ chart: "app", helm: { valueFiles: ["$values/deploy/n/a.yaml"] } },
					{ ref: "values", repoURL: "https://git.hanzo.ai/lux/universe" },
				],
			},
		};
		const out = await readDeclared([app], async () => "<html>login</html>");
		expect(out.size).toBe(0);
	});
});
