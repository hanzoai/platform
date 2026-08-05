import type { Registry } from "@hanzo/platform";
import { getRegistryTag } from "@hanzo/platform";
import { describe, expect, it } from "vitest";

describe("getRegistryTag", () => {
	// Helper to create a mock registry
	const createMockRegistry = (overrides: Partial<Registry> = {}): Registry => {
		return {
			registryId: "test-registry-id",
			registryName: "Test Registry",
			username: "myuser",
			password: "test-password",
			registryUrl: "docker.io",
			registryType: "cloud",
			imagePrefix: null,
			createdAt: new Date().toISOString(),
			organizationId: "test-org-id",
			...overrides,
		};
	};

	describe("with username (no imagePrefix)", () => {
		it("should handle simple image name without tag", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("docker.io/myuser/caddy");
		});

		it("should handle image name with tag", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "httpd:alpine");
			expect(result).toBe("docker.io/myuser/httpd:alpine");
		});

		it("should handle image name with username already present (no duplication)", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "myuser/myprivaterepo");
			// Should not duplicate username
			expect(result).toBe("docker.io/myuser/myprivaterepo");
		});

		it("should handle image name with username and tag already present", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "myuser/myprivaterepo:latest");
			// Should not duplicate username
			expect(result).toBe("docker.io/myuser/myprivaterepo:latest");
		});

		it("should handle complex image name with username", () => {
			const registry = createMockRegistry({ username: "siumauricio" });
			const result = getRegistryTag(
				registry,
				"siumauricio/app-parse-multi-byte-port-e32uh7",
			);
			// Should not duplicate username
			expect(result).toBe(
				"docker.io/siumauricio/app-parse-multi-byte-port-e32uh7",
			);
		});

		it("should handle image name with different username (should not duplicate)", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "otheruser/myprivaterepo");
			expect(result).toBe("docker.io/myuser/myprivaterepo");
		});

		it("should handle image name with full registry URL (no username)", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "docker.io/caddy");
			// Should add username since imageName doesn't have one
			expect(result).toBe("docker.io/myuser/caddy");
		});

		it("should handle image name with custom registry URL and username", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "ghcr.io/myuser/repo");
			// Should not duplicate username even if registry URL is different
			expect(result).toBe("docker.io/myuser/repo");
		});

		it("should handle image name with custom registry URL (different username)", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "ghcr.io/otheruser/repo");
			// Should use registry username, not the one in imageName
			expect(result).toBe("docker.io/myuser/repo");
		});
	});

	describe("with imagePrefix", () => {
		it("should use imagePrefix instead of username", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("docker.io/myorg/caddy");
		});

		it("should use imagePrefix with image tag", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
			});
			const result = getRegistryTag(registry, "httpd:alpine");
			expect(result).toBe("docker.io/myorg/httpd:alpine");
		});

		it("should handle imagePrefix with username already in image name", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
			});
			const result = getRegistryTag(registry, "myuser/myprivaterepo");
			expect(result).toBe("docker.io/myorg/myprivaterepo");
		});

		it("should handle imagePrefix matching image name prefix", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
			});
			const result = getRegistryTag(registry, "myorg/myprivaterepo");
			// Should not duplicate prefix
			expect(result).toBe("docker.io/myorg/myprivaterepo");
		});
	});

	describe("without registryUrl", () => {
		it("should work without registryUrl", () => {
			const registry = createMockRegistry({
				username: "myuser",
				registryUrl: "",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("myuser/caddy");
		});

		it("should work without registryUrl with imagePrefix", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
				registryUrl: "",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("myorg/caddy");
		});

		it("should handle username already present without registryUrl", () => {
			const registry = createMockRegistry({
				username: "myuser",
				registryUrl: "",
			});
			const result = getRegistryTag(registry, "myuser/myprivaterepo");
			// Should not duplicate username
			expect(result).toBe("myuser/myprivaterepo");
		});
	});

	describe("with custom registryUrl", () => {
		it("should handle custom registry URL", () => {
			const registry = createMockRegistry({
				username: "myuser",
				registryUrl: "ghcr.io",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("ghcr.io/myuser/caddy");
		});

		it("should handle custom registry URL with imagePrefix", () => {
			const registry = createMockRegistry({
				username: "myuser",
				imagePrefix: "myorg",
				registryUrl: "ghcr.io",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("ghcr.io/myorg/caddy");
		});

		it("should handle custom registry URL with username already present", () => {
			const registry = createMockRegistry({
				username: "myuser",
				registryUrl: "ghcr.io",
			});
			const result = getRegistryTag(registry, "myuser/myprivaterepo");
			// Should not duplicate username
			expect(result).toBe("ghcr.io/myuser/myprivaterepo");
		});
	});

	describe("edge cases", () => {
		it("should handle empty image name", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "");
			expect(result).toBe("docker.io/myuser/");
		});

		it("should handle image name with multiple slashes", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "org/suborg/repo");
			expect(result).toBe("docker.io/myuser/repo");
		});

		it("should handle image name with username at different position", () => {
			const registry = createMockRegistry({ username: "myuser" });
			const result = getRegistryTag(registry, "org/myuser/repo");
			expect(result).toBe("docker.io/myuser/repo");
		});
	});

	describe("special characters in username", () => {
		it("should handle Harbor robot account username with $ (e.g. robot$library+dokploy)", () => {
			const registry = createMockRegistry({
				username: "robot$library+dokploy",
			});
			const result = getRegistryTag(registry, "caddy");
			expect(result).toBe("docker.io/robot$library+dokploy/caddy");
		});

		it("should handle username with $ and other special characters", () => {
			const registry = createMockRegistry({
				username: "robot$test+app",
			});
			const result = getRegistryTag(registry, "myapp:latest");
			expect(result).toBe("docker.io/robot$test+app/myapp:latest");
		});

		it("should handle username with multiple $ symbols", () => {
			const registry = createMockRegistry({
				username: "user$name$test",
			});
			const result = getRegistryTag(registry, "app");
			expect(result).toBe("docker.io/user$name$test/app");
		});

		it("should handle username with + and - symbols", () => {
			const registry = createMockRegistry({
				username: "robot+test-user",
			});
			const result = getRegistryTag(registry, "httpd:alpine");
			expect(result).toBe("docker.io/robot+test-user/httpd:alpine");
		});
	});
});
