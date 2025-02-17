import { addHanzoNetworkToService } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzoNetworkToService", () => {
	it("should add network to an empty array", () => {
		const result = addHanzoNetworkToService([]);
		expect(result).toEqual(["hanzo-network"]);
	});

	it("should not add duplicate network to an array", () => {
		const result = addHanzoNetworkToService(["hanzo-network"]);
		expect(result).toEqual(["hanzo-network"]);
	});

	it("should add network to an existing array with other networks", () => {
		const result = addHanzoNetworkToService(["other-network"]);
		expect(result).toEqual(["other-network", "hanzo-network"]);
	});

	it("should add network to an object if networks is an object", () => {
		const result = addHanzoNetworkToService({ "other-network": {} });
		expect(result).toEqual({ "other-network": {}, "hanzo-network": {} });
	});
});
