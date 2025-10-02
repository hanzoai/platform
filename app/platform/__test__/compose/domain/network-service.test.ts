import { addHanzoNetworkToService } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzoNetworkToService", () => {
	it("should add network to an empty array", () => {
		const result = addHanzoNetworkToService([]);
		expect(result).toEqual(["platform-network"]);
	});

	it("should not add duplicate network to an array", () => {
		const result = addHanzoNetworkToService(["platform-network"]);
		expect(result).toEqual(["platform-network"]);
	});

	it("should add network to an existing array with other networks", () => {
		const result = addHanzoNetworkToService(["other-network"]);
		expect(result).toEqual(["other-network", "platform-network"]);
	});

	it("should add network to an object if networks is an object", () => {
		const result = addHanzoNetworkToService({ "other-network": {} });
		expect(result).toEqual({ "other-network": {}, "platform-network": {} });
	});
});
