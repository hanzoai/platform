/**
 * Tests for the PaaS ticket signing/verification used by the operator
 * admission webhook in tenant mode. The ticket protocol is the contract
 * between platform.hanzo.ai and the operator — round-trip tests pin
 * the wire shape and prevent regressions from a one-sided change.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	PAAS_TICKET_AUDIENCE,
	PAAS_TICKET_ISSUER,
	signPaasTicket,
	TicketVerificationError,
	verifyPaasTicket,
} from "@hanzo/platform/services/k8s/operator/tenant";

const SECRET = "x".repeat(32);

describe("PaaS ticket", () => {
	let originalSecret: string | undefined;

	beforeEach(() => {
		originalSecret = process.env.OPERATOR_PAAS_SHARED_SECRET;
		process.env.OPERATOR_PAAS_SHARED_SECRET = SECRET;
	});

	afterEach(() => {
		if (originalSecret === undefined) delete process.env.OPERATOR_PAAS_SHARED_SECRET;
		else process.env.OPERATOR_PAAS_SHARED_SECRET = originalSecret;
	});

	it("signs and verifies a round-trip ticket", () => {
		const ticket = signPaasTicket({
			organizationId: "org-acme",
			kind: "SQL",
			namespace: "tenant-org-acme",
			name: "postgres-prod",
			quota: { cpu: "2", memory: "4Gi", storage: "100Gi" },
		});

		const claims = verifyPaasTicket(ticket);
		expect(claims.iss).toBe(PAAS_TICKET_ISSUER);
		expect(claims.aud).toBe(PAAS_TICKET_AUDIENCE);
		expect(claims.sub).toBe("org-acme");
		expect(claims.kind).toBe("SQL");
		expect(claims.ns).toBe("tenant-org-acme");
		expect(claims.nm).toBe("postgres-prod");
		expect(claims.q).toEqual({ cpu: "2", memory: "4Gi", storage: "100Gi" });
		expect(claims.exp).toBeGreaterThan(claims.iat);
		expect(claims.jti).toMatch(/^[0-9a-f]{16}$/);
	});

	it("rejects a tampered signature", () => {
		const ticket = signPaasTicket({
			organizationId: "org-acme",
			kind: "SQL",
			namespace: "tenant-org-acme",
			name: "postgres-prod",
			quota: { cpu: "2", memory: "4Gi", storage: "100Gi" },
		});

		// Flip a bit in the signature.
		const parts = ticket.split(".");
		const sigBytes = Buffer.from(parts[2]!.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64");
		sigBytes[0] = (sigBytes[0] ?? 0) ^ 0x01;
		const tamperedSig = sigBytes
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const tampered = `${parts[0]}.${parts[1]}.${tamperedSig}`;

		expect(() => verifyPaasTicket(tampered)).toThrow(TicketVerificationError);
	});

	it("rejects an expired ticket", () => {
		const ticket = signPaasTicket({
			organizationId: "org-acme",
			kind: "SQL",
			namespace: "tenant-org-acme",
			name: "postgres-prod",
			quota: { cpu: "2", memory: "4Gi", storage: "100Gi" },
		});

		// Edit the payload to set exp in the past.
		const parts = ticket.split(".");
		const payload = JSON.parse(
			Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString("utf8"),
		);
		payload.exp = Math.floor(Date.now() / 1000) - 60;
		const newPayload = Buffer.from(JSON.stringify(payload), "utf8")
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		// Re-sign with our secret so the signature is valid but exp is past.
		const { createHmac } = require("node:crypto");
		const signingInput = `${parts[0]}.${newPayload}`;
		const sig = createHmac("sha256", SECRET)
			.update(signingInput)
			.digest("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const expired = `${signingInput}.${sig}`;

		expect(() => verifyPaasTicket(expired)).toThrow(/expired/);
	});

	it("rejects a wrong-secret signature", () => {
		const ticket = signPaasTicket({
			organizationId: "org-acme",
			kind: "SQL",
			namespace: "tenant-org-acme",
			name: "postgres-prod",
			quota: { cpu: "2", memory: "4Gi", storage: "100Gi" },
		});
		expect(() => verifyPaasTicket(ticket, "y".repeat(32))).toThrow(/bad signature/);
	});

	it("refuses to mint if the shared secret is too short", () => {
		process.env.OPERATOR_PAAS_SHARED_SECRET = "short";
		expect(() =>
			signPaasTicket({
				organizationId: "org-acme",
				kind: "SQL",
				namespace: "tenant-org-acme",
				name: "postgres-prod",
				quota: { cpu: "2", memory: "4Gi", storage: "100Gi" },
			}),
		).toThrow(/at least 32 bytes/);
	});
});
