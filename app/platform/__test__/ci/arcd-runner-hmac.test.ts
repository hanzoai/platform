import {
	signBody,
	verifyRunnerSignature,
} from "@hanzo/platform/services/ci/arcd-runner";
import { describe, expect, it } from "vitest";

const SECRET = "0123456789abcdef0123456789abcdef"; // 32+ chars

describe("arcd runner HMAC", () => {
	it("verifies a body it signed", () => {
		const body = JSON.stringify({ pool: "hanzoai-linux-amd64", runner_id: "evo-1" });
		expect(verifyRunnerSignature(body, signBody(body, SECRET), SECRET)).toBe(
			true,
		);
	});

	it("rejects a tampered body", () => {
		const body = JSON.stringify({ pool: "hanzoai-linux-amd64" });
		const sig = signBody(body, SECRET);
		expect(verifyRunnerSignature(`${body} `, sig, SECRET)).toBe(false);
	});

	it("rejects the wrong secret", () => {
		const body = "{}";
		expect(verifyRunnerSignature(body, signBody(body, SECRET), "other")).toBe(
			false,
		);
	});

	it("rejects a missing or malformed signature header", () => {
		expect(verifyRunnerSignature("{}", undefined, SECRET)).toBe(false);
		expect(verifyRunnerSignature("{}", "deadbeef", SECRET)).toBe(false);
		expect(verifyRunnerSignature("{}", "sha1=abc", SECRET)).toBe(false);
	});
});
