/**
 * The App private key must reach the JWT signer in the one encoding it accepts.
 *
 * GitHub issues App keys as PKCS#1; `universal-github-app-jwt` accepts only
 * PKCS#8 and throws on every request rather than at construction — so the App
 * path looks configured and silently fails per call. That is exactly how the
 * apps board's Latest column read empty for all 286 rows on 2026-07-29 while
 * `GITHUB_APP_*` was plainly set on the pod.
 */

import { generateKeyPairSync } from "node:crypto";
import { pkcs8 } from "@hanzo/platform/utils/providers/github";
import { describe, expect, it } from "vitest";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const asPkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const asPkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("pkcs8", () => {
	it("converts a PKCS#1 key — the form GitHub hands out — to PKCS#8", () => {
		expect(asPkcs1).toContain("BEGIN RSA PRIVATE KEY");
		const out = pkcs8(asPkcs1);
		expect(out).toContain("BEGIN PRIVATE KEY");
		expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
	});

	it("converts to the SAME key, not merely to the right shape", () => {
		expect(pkcs8(asPkcs1)).toBe(asPkcs8);
	});

	it("passes a PKCS#8 key through untouched", () => {
		expect(pkcs8(asPkcs8)).toBe(asPkcs8);
	});

	it("passes an unset key through, so the caller's own fallback still runs", () => {
		expect(pkcs8(undefined)).toBeUndefined();
	});

	it("returns an unparseable value as-is, leaving the error to the auth library", () => {
		const junk =
			"-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----";
		expect(pkcs8(junk)).toBe(junk);
	});
});
