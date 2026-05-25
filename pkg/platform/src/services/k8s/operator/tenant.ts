/**
 * PaaS ticket signing for operator admission webhook.
 *
 * Every operator CR materialized by platform.hanzo.ai carries a
 * `hanzo.ai/paas-ticket` annotation. The operator's admission webhook
 * (tenant mode) validates this ticket before admitting the CR.
 *
 * Ticket format: compact JWS, HS256 over a pre-shared secret. The shared
 * secret lives in K8s as `operator-paas-shared-secret`, mounted into
 * platform's pod and the operator's admission webhook pod.
 *
 * Why HS256 not RS256: platform and operator both run in the same
 * cluster (or platform mounts the operator's secret via KMSSecret).
 * Asymmetric only helps if either side is mutually untrusted, which
 * they aren't — both are first-party Hanzo workloads. HS256 keeps the
 * code small and avoids the X.509 / JWKS rotation surface.
 *
 * Ticket claims:
 *   iss   "platform.hanzo.ai"
 *   sub   <organizationId>
 *   aud   "operator.hanzo.ai"
 *   kind  "SQL" | "KV" | "DocDB" | "Service"
 *   ns    <namespace>
 *   nm    <cr-name>
 *   q     { cpu, memory, storage } -- quota requested
 *   iat   unix seconds
 *   exp   iat + 300 (5 min validity, enough for one apply)
 */
import { createHmac, randomBytes } from "node:crypto";

import type { OperatorKind } from "./cr-builder";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const PAAS_TICKET_ISSUER = "platform.hanzo.ai";
export const PAAS_TICKET_AUDIENCE = "operator.hanzo.ai";
const TICKET_TTL_SECONDS = 300;

function getSharedSecret(): string {
	const secret = process.env.OPERATOR_PAAS_SHARED_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			"OPERATOR_PAAS_SHARED_SECRET must be set to at least 32 bytes for tenant-mode operator integration",
		);
	}
	return secret;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuotaRequest {
	/** CPU quantity (e.g. "2", "500m"). */
	cpu: string;
	/** Memory quantity (e.g. "4Gi"). */
	memory: string;
	/** Storage quantity (e.g. "100Gi"). */
	storage: string;
}

export interface TicketClaims {
	iss: string;
	sub: string;
	aud: string;
	kind: OperatorKind;
	ns: string;
	nm: string;
	q: QuotaRequest;
	iat: number;
	exp: number;
	jti: string;
}

export interface TicketInput {
	organizationId: string;
	kind: OperatorKind;
	namespace: string;
	name: string;
	quota: QuotaRequest;
}

// ---------------------------------------------------------------------------
// base64url helpers (RFC 7515)
// ---------------------------------------------------------------------------

function b64urlEncode(input: Buffer | string): string {
	const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
	const padded = input.replace(/-/g, "+").replace(/_/g, "/");
	const padding = "=".repeat((4 - (padded.length % 4)) % 4);
	return Buffer.from(padded + padding, "base64");
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

/**
 * Mint a PaaS ticket. Returns a compact JWS (header.payload.signature).
 * Caller attaches as annotation `hanzo.ai/paas-ticket` on the CR.
 */
export function signPaasTicket(input: TicketInput): string {
	const secret = getSharedSecret();
	const now = Math.floor(Date.now() / 1000);

	const claims: TicketClaims = {
		iss: PAAS_TICKET_ISSUER,
		sub: input.organizationId,
		aud: PAAS_TICKET_AUDIENCE,
		kind: input.kind,
		ns: input.namespace,
		nm: input.name,
		q: input.quota,
		iat: now,
		exp: now + TICKET_TTL_SECONDS,
		jti: randomBytes(8).toString("hex"),
	};

	const header = { alg: "HS256", typ: "JWT" };
	const headerB64 = b64urlEncode(JSON.stringify(header));
	const payloadB64 = b64urlEncode(JSON.stringify(claims));
	const signingInput = `${headerB64}.${payloadB64}`;
	const sig = createHmac("sha256", secret).update(signingInput).digest();
	const sigB64 = b64urlEncode(sig);
	return `${signingInput}.${sigB64}`;
}

// ---------------------------------------------------------------------------
// Verify (operator-side helper, also used in tests)
// ---------------------------------------------------------------------------

export class TicketVerificationError extends Error {
	constructor(public reason: string) {
		super(`PaaS ticket invalid: ${reason}`);
		this.name = "TicketVerificationError";
	}
}

/**
 * Verify and decode a PaaS ticket. Throws TicketVerificationError on any
 * failure (bad signature, expired, wrong audience, malformed).
 *
 * This is the same routine the operator's admission webhook runs. Shipping
 * it here lets platform's tests pin the wire shape without depending on
 * the operator binary, and lets local dev tools (cli, scripts) round-trip
 * tickets without invoking the operator.
 */
export function verifyPaasTicket(token: string, secret?: string): TicketClaims {
	const sharedSecret = secret ?? getSharedSecret();
	const parts = token.split(".");
	if (parts.length !== 3) throw new TicketVerificationError("not a compact JWS");

	const headerB64 = parts[0]!;
	const payloadB64 = parts[1]!;
	const sigB64 = parts[2]!;
	const signingInput = `${headerB64}.${payloadB64}`;
	const expected = createHmac("sha256", sharedSecret).update(signingInput).digest();
	const actual = b64urlDecode(sigB64);

	if (expected.length !== actual.length) throw new TicketVerificationError("bad signature length");
	let mismatch = 0;
	for (let i = 0; i < expected.length; i++) mismatch |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
	if (mismatch !== 0) throw new TicketVerificationError("bad signature");

	let header: { alg?: string; typ?: string };
	let claims: TicketClaims;
	try {
		header = JSON.parse(b64urlDecode(headerB64).toString("utf8"));
		claims = JSON.parse(b64urlDecode(payloadB64).toString("utf8"));
	} catch {
		throw new TicketVerificationError("malformed JSON");
	}

	if (header.alg !== "HS256") throw new TicketVerificationError(`unsupported alg ${header.alg}`);

	const now = Math.floor(Date.now() / 1000);
	if (claims.iss !== PAAS_TICKET_ISSUER) throw new TicketVerificationError("wrong issuer");
	if (claims.aud !== PAAS_TICKET_AUDIENCE) throw new TicketVerificationError("wrong audience");
	if (now < claims.iat - 30) throw new TicketVerificationError("ticket issued in the future");
	if (now > claims.exp) throw new TicketVerificationError("ticket expired");

	return claims;
}
