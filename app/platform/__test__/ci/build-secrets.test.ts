import { fetchBuildSecrets } from "@hanzo/platform/services/ci/build-secrets";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The two JSON shapes fetchBuildSecrets reads: a login and a secret value. */
function jsonRes(status: number, body: unknown): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as unknown as Response;
}

describe("fetchBuildSecrets", () => {
	const OLD = { ...process.env };
	beforeEach(() => {
		process.env.KMS_CLIENT_ID = "hanzo-platform";
		process.env.KMS_CLIENT_SECRET = "secret";
		process.env.KMS_ENDPOINT = "https://api.hanzo.ai";
	});
	afterEach(() => {
		process.env = { ...OLD };
		vi.unstubAllGlobals();
	});

	it("returns {} without a login for an empty list", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		expect(await fetchBuildSecrets([], { path: "deploy", env: "prod" })).toEqual(
			{},
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("logs in once, reads each secret, returns a NAME→value map", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(jsonRes(200, { accessToken: "tok" }))
			.mockResolvedValueOnce(jsonRes(200, { value: "pk-abc" }))
			.mockResolvedValueOnce(jsonRes(200, { value: "pk-def" }));
		vi.stubGlobal("fetch", fetchMock);
		const out = await fetchBuildSecrets(["PUBLISHABLE_KEY", "PUBLIC_MAP"], {
			path: "deploy",
			env: "prod",
		});
		expect(out).toEqual({ PUBLISHABLE_KEY: "pk-abc", PUBLIC_MAP: "pk-def" });
		expect(fetchMock).toHaveBeenCalledTimes(3); // one login + two reads
		expect(fetchMock.mock.calls[0]![0]).toContain("/v1/kms/auth/login");
		expect(fetchMock.mock.calls[1]![0]).toContain(
			"/v1/kms/secrets/deploy/PUBLISHABLE_KEY?env=prod",
		);
	});

	it("THROWS (fail-closed) when the platform has no KMS credential", async () => {
		process.env.KMS_CLIENT_ID = "";
		process.env.IAM_CLIENT_ID = "";
		vi.stubGlobal("fetch", vi.fn());
		await expect(
			fetchBuildSecrets(["PUBLISHABLE_KEY"], { path: "deploy", env: "prod" }),
		).rejects.toThrow(/no KMS principal/);
	});

	it("THROWS when KMS login fails", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonRes(401, {})));
		await expect(
			fetchBuildSecrets(["PUBLISHABLE_KEY"], { path: "deploy", env: "prod" }),
		).rejects.toThrow(/KMS login failed/);
	});

	it("THROWS naming the secret when a read is not ok", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(jsonRes(200, { accessToken: "tok" }))
				.mockResolvedValueOnce(jsonRes(404, {})),
		);
		await expect(
			fetchBuildSecrets(["PUBLISHABLE_KEY"], { path: "deploy", env: "prod" }),
		).rejects.toThrow(/PUBLISHABLE_KEY is not readable/);
	});

	it("THROWS rather than bake an empty value", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(jsonRes(200, { accessToken: "tok" }))
				.mockResolvedValueOnce(jsonRes(200, { value: "" })),
		);
		await expect(
			fetchBuildSecrets(["PUBLISHABLE_KEY"], { path: "deploy", env: "prod" }),
		).rejects.toThrow(/resolved empty/);
	});
});
