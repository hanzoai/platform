/**
 * Route-level proof for POST /v1/runner — what the direct door asks of a caller.
 *
 * The delivery lane asks GitHub whose repository a delivery names. This door
 * has no delivery, so what it asks is the credential: the organization comes
 * off the identity that presented it, and the repository has to bear that out.
 *
 * The distinction is the whole test. A value a caller WRITES and the server
 * then cross-checks against the repository is not an entitlement — it is the
 * caller naming the organization that already owns the repository it wants
 * built, which is a thing anybody can look up. A value the caller cannot write
 * is a different kind of value, and only that kind decides whose images get
 * published on whose credential.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const HANZO = "Yb5GFGDBEwcLsv2O8qWjS";
const LUX = "Lx7QpZm2NvKd8RtYeWc1A";

const enqueueDirectBuild = vi.fn();
const validateRequest = vi.fn();

vi.mock("@hanzo/platform/services/ci", async (orig) => ({
	...(await orig<typeof import("@hanzo/platform/services/ci")>()),
	enqueueDirectBuild,
}));

vi.mock("@hanzo/platform/lib/auth", () => ({ validateRequest }));

const { POST } = await import("@/app/v1/runner/route");

/** A caller with no identity at all. */
const anonymous = { session: null, user: null };

/** A caller whose credential carries an organization. */
function acting(organizationId: string) {
	return {
		session: { userId: "u_1", activeOrganizationId: organizationId },
		user: { id: "u_1", email: "z@hanzo.ai" },
	};
}

function post(
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
): Promise<Response> {
	return POST(
		new Request("https://platform.hanzo.ai/v1/runner", {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		}),
	);
}

const build = {
	repo: "luxfi/node",
	ref: "refs/tags/v1.13.4",
	image: "ghcr.io/luxfi/node:v1.13.4",
	dockerfile: "Dockerfile.attacker",
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env.PLATFORM_BUILD_CALLBACK_TOKEN = "shared-machine-token";
	enqueueDirectBuild.mockResolvedValue({
		buildJobId: "bj_1",
		status: "running",
		runnerPool: "lux-build-linux-amd64",
		image: build.image,
		target: "linux/amd64",
	});
	validateRequest.mockResolvedValue(anonymous);
});

describe("what POST /v1/runner asks of a caller", () => {
	it("refuses a caller holding only the deployment's machine token", async () => {
		const res = await post(
			{ ...build, organizationId: LUX },
			{ authorization: "Bearer shared-machine-token" },
		);
		expect(res.status).toBe(401);
		expect(enqueueDirectBuild).not.toHaveBeenCalled();
	});

	it("refuses a caller with no identity", async () => {
		const res = await post(build);
		expect(res.status).toBe(401);
		expect(enqueueDirectBuild).not.toHaveBeenCalled();
	});

	it("takes the organization off the credential, never off the body", async () => {
		validateRequest.mockResolvedValue(acting(HANZO));
		// The body states Lux. The credential is Hanzo's. What reaches the build
		// path is Hanzo's — so the repository check below is about the caller's
		// real organization, and a stated one changes nothing.
		const res = await post({ ...build, organizationId: LUX });
		expect(res.status).toBe(202);
		expect(enqueueDirectBuild).toHaveBeenCalledTimes(1);
		expect(enqueueDirectBuild.mock.calls[0]?.[0]).toMatchObject({
			repo: build.repo,
			ref: build.ref,
			image: build.image,
			requireOrganizationId: HANZO,
		});
	});

	it("hands the build path an organization the caller could not have written", async () => {
		validateRequest.mockResolvedValue(acting(LUX));
		await post(build);
		const passed = enqueueDirectBuild.mock.calls[0]?.[0] as Record<
			string,
			unknown
		>;
		expect(passed.requireOrganizationId).toBe(LUX);
		// And the request body is not a source of one.
		expect(Object.keys(passed)).not.toContain("organizationId");
	});

	it("reports the build path's refusal as a refusal", async () => {
		validateRequest.mockResolvedValue(acting(HANZO));
		const { TRPCError } = await import("@trpc/server");
		enqueueDirectBuild.mockRejectedValue(
			new TRPCError({ code: "FORBIDDEN", message: "not your organization" }),
		);
		const res = await post(build);
		expect(res.status).toBe(403);
	});

	it("still answers the request rules before it reaches the build path", async () => {
		validateRequest.mockResolvedValue(acting(HANZO));
		for (const bad of [
			{ ...build, repo: "not-a-repo" },
			{ ...build, repo: "" },
			{ ...build, image: undefined },
			{ ...build, ref: undefined },
		]) {
			const res = await post(bad as Record<string, unknown>);
			expect(res.status, JSON.stringify(bad)).toBe(400);
		}
		expect(enqueueDirectBuild).not.toHaveBeenCalled();
	});
});
