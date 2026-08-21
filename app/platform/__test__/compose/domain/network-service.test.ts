import { addHanzoPlatformNetworkToService } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzoPlatformNetworkToService", () => {
	it("should add network to an empty array", () => {
		const result = addHanzoPlatformNetworkToService([]);
		expect(result).toEqual(["platform-network", "default"]);
	});

	it("should not add duplicate network to an array", () => {
		const result = addHanzoPlatformNetworkToService(["platform-network"]);
		expect(result).toEqual(["platform-network", "default"]);
	});

	it("should add network to an existing array with other networks", () => {
		const result = addHanzoPlatformNetworkToService(["other-network"]);
		expect(result).toEqual(["other-network", "platform-network", "default"]);
	});

	it("should add network to an object if networks is an object", () => {
		const result = addHanzoPlatformNetworkToService({ "other-network": {} });
		expect(result).toEqual({
			"other-network": {},
			"platform-network": {},
			default: {},
		});
	});

	it("should not duplicate default network when already present", () => {
		const result = addHanzoPlatformNetworkToService([
			"default",
			"platform-network",
		]);
		expect(result).toEqual(["default", "platform-network"]);
	});
});
