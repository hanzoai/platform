import {
	type HanzoDnsConfig,
	HanzoDnsProvider,
} from "@hanzo/platform/services/hanzo-dns-provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Test seam: inject config so the provider does not read env (vitest `define`
// hard-replaces process.env, and the real key is never present in CI).
const CONFIG: HanzoDnsConfig = {
	baseUrl: "https://dns.test",
	apiToken: "secret-key",
};

const provider = new HanzoDnsProvider(CONFIG);

/** Build a minimal fetch Response stub carrying both text() and json(). */
function stubResponse(status: number, body: unknown) {
	return {
		ok: status >= 200 && status < 300,
		status,
		text: async () => JSON.stringify(body),
		json: async () => body,
	} as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

/** [url, init] of the Nth fetch call. */
function call(n = 0): [string, RequestInit] {
	return fetchMock.mock.calls[n] as [string, RequestInit];
}

describe("HanzoDnsProvider — hits the deployed /v1/dns contract", () => {
	it("listZones GETs /v1/dns/zones, unwraps {zones}, maps to zone name", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(200, {
				zones: [
					{
						id: "uuid-1",
						zone: "example.com.",
						status: "active",
						nameservers: ["ns1.hanzo.ai.", "ns2.hanzo.ai."],
						record_count: 2,
						dnssec_enabled: true,
						created_at: "2026-07-18T00:00:00Z",
						updated_at: "2026-07-18T00:00:00Z",
					},
				],
				total: 1,
			}),
		);

		const zones = await provider.listZones();

		const [url, init] = call();
		expect(url).toBe("https://dns.test/v1/dns/zones"); // NOT /api/v1/zones
		expect(init.method ?? "GET").toBe("GET");
		expect((init.headers as Record<string, string>).Authorization).toBe(
			"Bearer secret-key",
		);
		expect(zones).toHaveLength(1);
		// Records are addressed by zone NAME → id === name (round-trips as zoneId).
		expect(zones[0]).toMatchObject({
			id: "example.com.",
			name: "example.com.",
			provider: "hanzo",
			nameServers: ["ns1.hanzo.ai.", "ns2.hanzo.ai."],
		});
	});

	it("createZone POSTs {zone} (not {name})", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(201, {
				id: "u",
				zone: "new.com.",
				status: "active",
				nameservers: [],
				record_count: 0,
				dnssec_enabled: false,
				created_at: "",
				updated_at: "",
			}),
		);

		const zone = await provider.createZone("new.com");

		const [url, init] = call();
		expect(url).toBe("https://dns.test/v1/dns/zones");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({ zone: "new.com" });
		expect(zone.name).toBe("new.com.");
	});

	it("listRecords GETs /v1/dns/zones/{name}/records and unwraps {records}", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(200, {
				records: [
					{
						id: "r1",
						name: "www",
						type: "A",
						content: "1.2.3.4",
						ttl: 300,
						proxied: true,
						priority: 0,
						created_at: "",
						updated_at: "",
					},
				],
				total: 1,
			}),
		);

		const records = await provider.listRecords("example.com.");

		const [url, init] = call();
		expect(url).toBe("https://dns.test/v1/dns/zones/example.com./records");
		expect(init.method ?? "GET").toBe("GET");
		expect(records[0]).toMatchObject({
			id: "r1",
			zoneId: "example.com.", // synthesized from the zone name
			content: "1.2.3.4",
			proxied: true,
		});
	});

	it("createRecord POSTs the record body to the zone's records path", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(201, {
				id: "r2",
				name: "mail",
				type: "MX",
				content: "mx.example.com",
				ttl: 300,
				priority: 10,
				proxied: false,
				created_at: "",
				updated_at: "",
			}),
		);

		await provider.createRecord("example.com.", {
			type: "MX",
			name: "mail",
			content: "mx.example.com",
			ttl: 300,
			priority: 10,
		});

		const [url, init] = call();
		expect(url).toBe("https://dns.test/v1/dns/zones/example.com./records");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toMatchObject({
			name: "mail",
			type: "MX",
			content: "mx.example.com",
			ttl: 300,
			priority: 10,
		});
	});

	it("updateRecord PATCHes /v1/dns/zones/{name}/records/{id}", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(200, {
				id: "r1",
				name: "www",
				type: "A",
				content: "9.9.9.9",
				ttl: 60,
				proxied: false,
				priority: 0,
				created_at: "",
				updated_at: "",
			}),
		);

		await provider.updateRecord("example.com.", "r1", {
			content: "9.9.9.9",
			ttl: 60,
		});

		const [url, init] = call();
		expect(url).toBe("https://dns.test/v1/dns/zones/example.com./records/r1");
		expect(init.method).toBe("PATCH"); // partial update, not PUT
		expect(JSON.parse(init.body as string)).toMatchObject({
			content: "9.9.9.9",
			ttl: 60,
		});
	});

	it("deleteRecord / deleteZone DELETE and resolve void", async () => {
		fetchMock.mockResolvedValueOnce(stubResponse(200, {}));
		await expect(
			provider.deleteRecord("example.com.", "r1"),
		).resolves.toBeUndefined();
		expect(call()[0]).toBe(
			"https://dns.test/v1/dns/zones/example.com./records/r1",
		);
		expect(call()[1].method).toBe("DELETE");

		fetchMock.mockResolvedValueOnce(stubResponse(204, undefined));
		await expect(provider.deleteZone("example.com.")).resolves.toBeUndefined();
	});

	it("surfaces the {code,message} error body on a non-2xx", async () => {
		fetchMock.mockResolvedValueOnce(
			stubResponse(404, { code: "not_found", message: "zone not found" }),
		);
		await expect(provider.getZone("nope.com.")).rejects.toThrow(
			/zone not found/,
		);
	});
});
