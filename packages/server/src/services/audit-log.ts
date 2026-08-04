import { db } from "@dokploy/server/db";
import type { AuditAction, AuditResourceType } from "@dokploy/server/db/schema";
import { auditLog } from "@dokploy/server/db/schema";
import { and, desc, eq, gte, ilike, lte } from "drizzle-orm";

export type { AuditAction, AuditResourceType };

export interface CreateAuditLogInput {
	organizationId: string;
	userId: string;
	userEmail: string;
	userRole: string;
	action: AuditAction;
	resourceType: AuditResourceType;
	resourceId?: string;
	resourceName?: string;
	metadata?: Record<string, unknown>;
}

/**
 * Writes one audit record. Fire-and-forget: a logging failure must never fail
 * the operation being logged, so errors are reported and swallowed.
 *
 * Auditing is unconditional. It is a security control, not a paid add-on, so
 * there is no licence check here and there must never be one again.
 */
export const createAuditLog = async ({
	metadata,
	...entry
}: CreateAuditLogInput) => {
	try {
		await db.insert(auditLog).values({
			...entry,
			metadata: metadata ? JSON.stringify(metadata) : undefined,
		});
	} catch (err) {
		console.error("[audit-log] failed to write entry:", err);
	}
};

export interface GetAuditLogsInput {
	organizationId: string;
	userId?: string;
	userEmail?: string;
	resourceName?: string;
	action?: AuditAction;
	resourceType?: AuditResourceType;
	from?: Date;
	to?: Date;
	limit?: number;
	offset?: number;
}

/** Reads one organization's audit records, newest first. */
export const getAuditLogs = async ({
	organizationId,
	userId,
	userEmail,
	resourceName,
	action,
	resourceType,
	from,
	to,
	limit = 50,
	offset = 0,
}: GetAuditLogsInput) => {
	const where = and(
		eq(auditLog.organizationId, organizationId),
		...(userId ? [eq(auditLog.userId, userId)] : []),
		...(userEmail ? [ilike(auditLog.userEmail, `%${userEmail}%`)] : []),
		...(resourceName
			? [ilike(auditLog.resourceName, `%${resourceName}%`)]
			: []),
		...(action ? [eq(auditLog.action, action)] : []),
		...(resourceType ? [eq(auditLog.resourceType, resourceType)] : []),
		...(from ? [gte(auditLog.createdAt, from)] : []),
		...(to ? [lte(auditLog.createdAt, to)] : []),
	);

	const [logs, total] = await Promise.all([
		db.query.auditLog.findMany({
			where,
			orderBy: [desc(auditLog.createdAt)],
			limit,
			offset,
		}),
		db.$count(auditLog, where),
	]);

	return { logs, total };
};
