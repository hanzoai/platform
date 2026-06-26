/**
 * secret-box — authenticated symmetric encryption for the few values platform
 * must keep AT REST (today: an attached BYO cluster's kubeconfig).
 *
 * Most platform secrets never live in the DB: they arrive as KMS-synced env
 * vars (see services/kms.ts) and managed-cluster kubeconfigs are derived on
 * demand from DigitalOcean. A bring-your-own cluster has no DO to derive from,
 * so its kubeconfig is the first value that must be persisted — and it is
 * persisted ONLY as ciphertext.
 *
 * AES-256-GCM (authenticated): tampering with the stored ciphertext fails the
 * auth-tag check on open() rather than yielding a forged kubeconfig. The key is
 * derived (SHA-256) from the KMS-synced `PAAS_SECRET_KEY` (falling back to
 * `BETTER_AUTH_SECRET`, the existing app secret). Fail closed: refuse to seal
 * when no real key is configured rather than store a weakly-protected secret.
 *
 * Wire format: `v1:<iv b64>:<tag b64>:<ciphertext b64>` — versioned so the
 * scheme can evolve without ambiguity.
 */
import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import { kmsSecret } from "./kms";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = "v1";

/** 32-byte key derived from the configured secret. Fails closed when absent. */
function secretKey(): Buffer {
	const secret = kmsSecret("PAAS_SECRET_KEY") ?? process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"PAAS_SECRET_KEY (or BETTER_AUTH_SECRET) must be set to encrypt secrets at rest — refusing to store an unprotected kubeconfig",
		});
	}
	return createHash("sha256").update(secret).digest();
}

/** Encrypt `plaintext` → `v1:<iv>:<tag>:<ciphertext>` (all base64). */
export function sealSecret(plaintext: string): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, secretKey(), iv);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	const tag = cipher.getAuthTag();
	return [
		VERSION,
		iv.toString("base64"),
		tag.toString("base64"),
		ciphertext.toString("base64"),
	].join(":");
}

/** Decrypt a `sealSecret` string. Throws on a malformed or tampered value. */
export function openSecret(sealed: string): string {
	const parts = sealed.split(":");
	if (parts.length !== 4 || parts[0] !== VERSION) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Malformed sealed secret",
		});
	}
	const iv = Buffer.from(parts[1]!, "base64");
	const tag = Buffer.from(parts[2]!, "base64");
	const ciphertext = Buffer.from(parts[3]!, "base64");
	const decipher = createDecipheriv(ALGO, secretKey(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([
		decipher.update(ciphertext),
		decipher.final(),
	]).toString("utf8");
}
