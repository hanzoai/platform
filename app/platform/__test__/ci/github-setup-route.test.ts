/**
 * What GET /v1/providers/github/setup writes, and on whose word.
 *
 * `gh_setup` binds an installation id to an App row, and that binding is what
 * every later delivery is authenticated by: the id names the row, the row holds
 * the webhook secret and the organization. Both halves of the binding arrive as
 * URL parameters from a browser GitHub sent back, so both are values the person
 * who followed the link chose.
 *
 * The row half is already answered off the session. The installation half is
 * answered by GitHub, which is the only party that knows which installations an
 * App has — a number that merely looks like one is not one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const HANZO = "org-hanzo";
const LUX = "org-lux";

const validateRequest = vi.fn();
const findFirst = vi.fn();
const set = vi.fn();
const getInstallation = vi.fn();
const createGithub = vi.fn();

vi.mock("@hanzo/platform/lib/auth", () => ({ validateRequest }));
vi.mock("@hanzo/platform/services/github", () => ({ createGithub }));

vi.mock("@hanzo/platform/db", async () => {
	const { eq } = await import("drizzle-orm");
	const where = vi.fn(async () => undefined);
	return {
		db: {
			query: { github: { findFirst } },
			update: () => ({
				set: (v: unknown) => {
					set(v);
					return { where };
				},
			}),
		},
		eq,
	};
});

vi.mock("octokit", () => ({
	Octokit: class {
		rest = { apps: { getInstallation } };
		request = vi.fn();
	},
}));

const { GET } = await import("@/app/v1/providers/github/setup/route");

const APP = {
	githubId: "gh_1",
	githubAppId: 1164625,
	githubPrivateKey: "-----BEGIN PRIVATE KEY-----\nk\n-----END PRIVATE KEY-----",
	gitProvider: { organizationId: HANZO },
};

function visit(params: Record<string, string>) {
	const url = new URL("https://platform.hanzo.ai/v1/providers/github/setup");
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	return GET(new Request(url));
}

beforeEach(() => {
	vi.clearAllMocks();
	validateRequest.mockResolvedValue({
		session: { activeOrganizationId: HANZO },
		user: { id: "u_1" },
	});
	findFirst.mockResolvedValue(APP);
	// GitHub's answer: this App has installation 42 and knows nothing else.
	getInstallation.mockImplementation(
		async ({ installation_id }: { installation_id: number }) => {
			if (installation_id !== 42) {
				throw Object.assign(new Error("Not Found"), { status: 404 });
			}
			return { data: { id: 42 } };
		},
	);
});

describe("gh_setup binds an installation to an App", () => {
	it("writes the binding when GitHub says the App has that installation", async () => {
		const res = await visit({
			code: "c",
			state: "gh_setup:gh_1",
			installation_id: "42",
		});
		expect(res.status).toBe(307);
		expect(set).toHaveBeenCalledWith({ githubInstallationId: "42" });
	});

	it("refuses an installation GitHub does not place on this App", async () => {
		const res = await visit({
			code: "c",
			state: "gh_setup:gh_1",
			installation_id: "99",
		});
		expect(res.status).toBe(404);
		expect(set).not.toHaveBeenCalled();
	});

	it("refuses an App row belonging to another organization", async () => {
		findFirst.mockResolvedValue({
			...APP,
			gitProvider: { organizationId: LUX },
		});
		const res = await visit({
			code: "c",
			state: "gh_setup:gh_1",
			installation_id: "42",
		});
		expect(res.status).toBe(404);
		expect(set).not.toHaveBeenCalled();
		expect(getInstallation).not.toHaveBeenCalled();
	});

	it("refuses an installation id that is not a number", async () => {
		for (const id of ["4 2", "42a", "", "-1", "0x2a"]) {
			const res = await visit({
				code: "c",
				state: "gh_setup:gh_1",
				installation_id: id,
			});
			expect(res.status, id).toBe(400);
		}
		expect(set).not.toHaveBeenCalled();
	});

	it("refuses a caller with no session", async () => {
		validateRequest.mockResolvedValue({ session: null, user: null });
		const res = await visit({
			code: "c",
			state: "gh_setup:gh_1",
			installation_id: "42",
		});
		expect(res.status).toBe(401);
		expect(set).not.toHaveBeenCalled();
	});
});
