import { addHanzoNetworkToRoot } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzoNetworkToRoot", () => {
	it("should create network object if networks is undefined", () => {
		const result = addHanzoNetworkToRoot(undefined);
		expect(result).toEqual({ "hanzo-network": { external: true } });
	});

	it("should add network to an empty object", () => {
		const result = addHanzoNetworkToRoot({});
		expect(result).toEqual({ "hanzo-network": { external: true } });
	});

	it("should not modify existing network configuration", () => {
		const existing = { "hanzo-network": { external: false } };
		const result = addHanzoNetworkToRoot(existing);
		expect(result).toEqual({ "hanzo-network": { external: true } });
	});

	it("should add network alongside existing networks", () => {
		const existing = { "other-network": { external: true } };
		const result = addHanzoNetworkToRoot(existing);
		expect(result).toEqual({
			"other-network": { external: true },
			"hanzo-network": { external: true },
		});
	});
});
