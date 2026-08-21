/**
 * Unit tests for services/secret-box — the AES-256-GCM seal/open used to keep an
 * attached BYO cluster's kubeconfig encrypted at rest. Pure crypto, no DB/network.
 *
 * The key is sourced from BETTER_AUTH_SECRET / PAAS_SECRET_KEY; set it at runtime
 * (the same pattern the KMS gating test uses for PAAS_DO_API_TOKEN).
 */

import { openSecret, sealSecret } from "@hanzo/platform/services/secret-box";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const KUBECONFIG = "apiVersion: v1\nkind: Config\nclusters:\n- name: byo\n";

describe("secret-box", () => {
	let original: string | undefined;
	beforeAll(() => {
		original = process.env.PAAS_SECRET_KEY;
		process.env.PAAS_SECRET_KEY = "test-secret-box-key-0123456789abcdef";
	});
	afterAll(() => {
		if (original === undefined) delete process.env.PAAS_SECRET_KEY;
		else process.env.PAAS_SECRET_KEY = original;
	});

	it("roundtrips a value through seal → open", () => {
		expect(openSecret(sealSecret(KUBECONFIG))).toBe(KUBECONFIG);
	});

	it("produces a versioned, non-plaintext ciphertext", () => {
		const sealed = sealSecret(KUBECONFIG);
		expect(sealed.startsWith("v1:")).toBe(true);
		// The plaintext must not appear anywhere in the sealed string.
		expect(sealed).not.toContain("apiVersion");
		expect(sealed.split(":")).toHaveLength(4);
	});

	it("uses a fresh IV each time (distinct ciphertexts for the same input)", () => {
		expect(sealSecret(KUBECONFIG)).not.toBe(sealSecret(KUBECONFIG));
	});

	it("rejects a tampered ciphertext (GCM auth tag)", () => {
		const parts = sealSecret(KUBECONFIG).split(":");
		// Flip the last base64 char of the ciphertext segment.
		const ct = parts[3]!;
		const flipped = `${ct.slice(0, -1)}${ct.at(-1) === "A" ? "B" : "A"}`;
		const tampered = [parts[0], parts[1], parts[2], flipped].join(":");
		expect(() => openSecret(tampered)).toThrow();
	});

	it("rejects a malformed sealed value", () => {
		expect(() => openSecret("not-a-sealed-secret")).toThrow();
		expect(() => openSecret("v1:only:three")).toThrow();
	});
});
