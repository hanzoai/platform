import { addHanzoPlatformNetworkToRoot } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("addHanzoPlatformNetworkToRoot", () => {
	it("should create network object if networks is undefined", () => {
		const result = addHanzoPlatformNetworkToRoot(undefined);
		expect(result).toEqual({ "platform-network": { external: true } });
	});

	it("should add network to an empty object", () => {
		const result = addHanzoPlatformNetworkToRoot({});
		expect(result).toEqual({ "platform-network": { external: true } });
	});

	it("should not modify existing network configuration", () => {
		const existing = { "platform-network": { external: false } };
		const result = addHanzoPlatformNetworkToRoot(existing);
		expect(result).toEqual({ "platform-network": { external: true } });
	});

	it("should add network alongside existing networks", () => {
		const existing = { "other-network": { external: true } };
		const result = addHanzoPlatformNetworkToRoot(existing);
		expect(result).toEqual({
			"other-network": { external: true },
			"platform-network": { external: true },
		});
	});
});
