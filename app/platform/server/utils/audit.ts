/**
 * audit.ts — a lightweight stdout audit-trail sink.
 *
 * This is the structured-logging variant of the audit sink: every
 * event is emitted as a single JSON line on stdout, which the o11y stack
 * (platform.hanzo.ai logging) ingests as the audit stream. When the fork
 * re-introduces a first-party `auditLog` table, swap the `console` write for a
 * `db.insert(auditLog)` here — the call sites do not change.
 *
 * It is intentionally non-throwing: an audit-sink failure must never fail the
 * operation being audited.
 */

export type AuditAction =
	| "create"
	| "update"
	| "delete"
	| "deploy"
	| "rollback"
	| "access";

export interface AuditEvent {
	action: AuditAction | string;
	resourceType: string;
	resourceId?: string;
	resourceName?: string;
	metadata?: Record<string, unknown>;
}

/** The minimal slice of the tRPC context the audit sink reads. */
interface AuditCtx {
	session?: {
		activeOrganizationId?: string | null;
		userId?: string | null;
	} | null;
	user?: { id?: string | null } | null;
}

/**
 * Record one audit event for the caller's organization. Resolves the actor and
 * org from the request context and emits a structured line; never throws.
 */
export async function audit(ctx: AuditCtx, event: AuditEvent): Promise<void> {
	try {
		const organizationId = ctx.session?.activeOrganizationId ?? null;
		const userId = ctx.user?.id ?? ctx.session?.userId ?? null;
		console.log(
			JSON.stringify({
				kind: "audit",
				at: new Date().toISOString(),
				organizationId,
				userId,
				...event,
			}),
		);
	} catch {
		// An audit-sink failure must never break the audited operation.
	}
}
