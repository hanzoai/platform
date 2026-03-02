import { addHanzo PlatformNetworkToService } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzo PlatformNetworkToService", () => {
	it("should add network to an empty array", () => {
		const result = addHanzo PlatformNetworkToService([]);
		expect(result).toEqual(["platform-network", "default"]);
	});

	it("should not add duplicate network to an array", () => {
		const result = addHanzo PlatformNetworkToService(["platform-network"]);
		expect(result).toEqual(["platform-network", "default"]);
	});

	it("should add network to an existing array with other networks", () => {
		const result = addHanzo PlatformNetworkToService(["other-network"]);
		expect(result).toEqual(["other-network", "platform-network", "default"]);
	});

	it("should add network to an object if networks is an object", () => {
		const result = addHanzo PlatformNetworkToService({ "other-network": {} });
		expect(result).toEqual({
			"other-network": {},
			"platform-network": {},
			default: {},
		});
	});

	it("should not duplicate default network when already present", () => {
		const result = addHanzo PlatformNetworkToService(["default", "platform-network"]);
		expect(result).toEqual(["default", "platform-network"]);
	});
});
