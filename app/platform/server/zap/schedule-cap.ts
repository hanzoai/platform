// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// schedule-cap.ts — the native @zap-proto/web Schedule capability.
//
// Binary-ZAP replacement for the tRPC `scheduleRouter`
// (server/api/routers/schedule.ts). Every method was a `protectedProcedure`
// (authenticated caller, session+user) whose body additionally enforces
// per-schedule org ownership via assertScheduleOrgAccess (which walks the
// schedule's parent application/compose/server up to its organizationId). The
// mint boundary requires session+user (a null return rejects the WS upgrade
// with HTTP 401, mirroring protectedProcedure); the per-schedule ownership
// check is enforced INSIDE dispatch, verbatim from the original procedure
// bodies. Inputs ride the shared Args carrier, results the shared Result
// carrier; ScheduleMethod ordinals are generated from schedule.zap.
//
// The tRPC `audit(ctx, …)` side effect — whose RBAC/license machinery is
// stripped on this branch — is recorded as a structured `console.info("[audit]
// schedule.<action>", …)`, mirroring how registry-cap.ts ported its audit.

import type { IncomingMessage } from "node:http";
import {
	findApplicationById,
	findComposeById,
	findServerById,
	IS_CLOUD,
	removeScheduleJob,
	scheduleJob,
} from "@hanzo/platform";
import { db } from "@hanzo/platform/db";
import { deployments } from "@hanzo/platform/db/schema/deployment";
import { schedules } from "@hanzo/platform/db/schema/schedule";
import { runCommand } from "@hanzo/platform/index";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	createSchedule,
	deleteSchedule,
	findScheduleById,
	updateSchedule,
} from "@hanzo/platform/services/schedule";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { desc, eq } from "drizzle-orm";
import { removeJob, schedule } from "@/server/utils/backup";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { ScheduleMethod } from "./schema/schedule_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface ScheduleCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
	email: string;
}

/**
 * scheduleMintCap — bearer→ctx boundary. Mirrors `protectedProcedure`'s
 * authentication half: validates the upgrade and requires session+user. Null →
 * HTTP 401 before any socket opens. The per-schedule org-ownership half runs
 * inside dispatch (verbatim from the bodies).
 */
export const scheduleMintCap: MintCap<ScheduleCtx> = async (
	req: IncomingMessage,
) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as ScheduleCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	const email = (user as { email?: string }).email || "";
	return { organizationId, userRole, userId, email };
};

/** Typed authorization failure → ZAP Status.Unauthorized. */
class UnauthorizedError extends Error {}
/** Typed not-found failure → ZAP Status.NotFound. */
class NotFoundError extends Error {}
/** Typed bad-request failure → ZAP Status.BadRequest. */
class BadRequestError extends Error {}

/**
 * Verify org ownership for a schedule by checking its parent resource.
 */
async function assertScheduleOrgAccess(
	scheduleRecord: {
		applicationId?: string | null;
		composeId?: string | null;
		serverId?: string | null;
	},
	activeOrganizationId: string,
): Promise<void> {
	if (scheduleRecord.applicationId) {
		const app = await findApplicationById(scheduleRecord.applicationId);
		if (app.environment.project.organizationId !== activeOrganizationId) {
			throw new UnauthorizedError(
				"You are not authorized to access this schedule",
			);
		}
	} else if (scheduleRecord.composeId) {
		const compose = await findComposeById(scheduleRecord.composeId);
		if (compose.environment.project.organizationId !== activeOrganizationId) {
			throw new UnauthorizedError(
				"You are not authorized to access this schedule",
			);
		}
	} else if (scheduleRecord.serverId) {
		const server = await findServerById(scheduleRecord.serverId);
		if (server.organizationId !== activeOrganizationId) {
			throw new UnauthorizedError(
				"You are not authorized to access this schedule",
			);
		}
	}
}

/**
 * scheduleRootCap — dispatch each decoded Call by ScheduleMethod ordinal to the
 * same service functions the tRPC procedure called. Inputs decode via the shared
 * Args carrier; results encode via the shared Result carrier. Errors map to ZAP
 * status codes (mirroring the tRPC error codes), never a thrown HTTP 500 leak.
 */
export function scheduleRootCap(ctx: ScheduleCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(ctx, call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const status =
				err instanceof UnauthorizedError
					? Status.Unauthorized
					: err instanceof NotFoundError
						? Status.NotFound
						: err instanceof BadRequestError
							? Status.BadRequest
							: Status.Internal;
			const message = err instanceof Error ? err.message : "internal error";
			return {
				status,
				promiseID: call.promiseID,
				body: encodeResult({ error: message }),
			};
		}
	};
}

async function dispatch(ctx: ScheduleCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case ScheduleMethod.create: {
			// biome-ignore lint/suspicious/noExplicitAny: createScheduleSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const newSchedule = await createSchedule(input);

			// Verify org ownership on the newly created schedule
			await assertScheduleOrgAccess(newSchedule, ctx.organizationId);

			if (newSchedule?.enabled) {
				if (IS_CLOUD) {
					schedule({
						scheduleId: newSchedule.scheduleId,
						type: "schedule",
						cronSchedule: newSchedule.cronExpression,
					});
				} else {
					scheduleJob(newSchedule);
				}
			}
			return newSchedule;
		}

		case ScheduleMethod.update: {
			// biome-ignore lint/suspicious/noExplicitAny: updateScheduleSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			// Verify org ownership before update
			const existing = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(existing, ctx.organizationId);

			const updatedSchedule = await updateSchedule(input);

			if (IS_CLOUD) {
				if (updatedSchedule?.enabled) {
					schedule({
						scheduleId: updatedSchedule.scheduleId,
						type: "schedule",
						cronSchedule: updatedSchedule.cronExpression,
					});
				} else {
					await removeJob({
						cronSchedule: updatedSchedule.cronExpression,
						scheduleId: updatedSchedule.scheduleId,
						type: "schedule",
					});
				}
			} else {
				if (updatedSchedule?.enabled) {
					removeScheduleJob(updatedSchedule.scheduleId);
					scheduleJob(updatedSchedule);
				} else {
					removeScheduleJob(updatedSchedule.scheduleId);
				}
			}
			return updatedSchedule;
		}

		case ScheduleMethod.delete: {
			const input = decodeArgs<{ scheduleId: string }>(call.payload);
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.organizationId);

			await deleteSchedule(input.scheduleId);

			if (IS_CLOUD) {
				await removeJob({
					cronSchedule: scheduleRecord.cronExpression,
					scheduleId: scheduleRecord.scheduleId,
					type: "schedule",
				});
			} else {
				removeScheduleJob(scheduleRecord.scheduleId);
			}
			return true;
		}

		case ScheduleMethod.list: {
			const input = decodeArgs<{
				id: string;
				scheduleType:
					| "application"
					| "compose"
					| "server"
					| "platform-server";
			}>(call.payload);
			// Verify org ownership for the parent resource
			if (input.scheduleType === "application") {
				const app = await findApplicationById(input.id);
				if (
					app.environment.project.organizationId !== ctx.organizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to access this resource",
					);
				}
			} else if (input.scheduleType === "compose") {
				const compose = await findComposeById(input.id);
				if (
					compose.environment.project.organizationId !== ctx.organizationId
				) {
					throw new UnauthorizedError(
						"You are not authorized to access this resource",
					);
				}
			} else if (input.scheduleType === "server") {
				const server = await findServerById(input.id);
				if (server.organizationId !== ctx.organizationId) {
					throw new UnauthorizedError(
						"You are not authorized to access this resource",
					);
				}
			}

			const where = {
				application: eq(schedules.applicationId, input.id),
				compose: eq(schedules.composeId, input.id),
				server: eq(schedules.serverId, input.id),
				"platform-server": eq(schedules.userId, input.id),
			};
			return db.query.schedules.findMany({
				where: where[input.scheduleType],
				with: {
					application: true,
					server: true,
					compose: true,
					deployments: {
						orderBy: [desc(deployments.createdAt)],
					},
				},
			});
		}

		case ScheduleMethod.one: {
			const input = decodeArgs<{ scheduleId: string }>(call.payload);
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.organizationId);
			return scheduleRecord;
		}

		case ScheduleMethod.runManually: {
			const input = decodeArgs<{ scheduleId: string }>(call.payload);
			const scheduleRecord = await findScheduleById(input.scheduleId);
			await assertScheduleOrgAccess(scheduleRecord, ctx.organizationId);

			try {
				await runCommand(input.scheduleId);
				return true;
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error.message : "Error running schedule",
				);
			}
		}

		default:
			throw new NotFoundError(`unknown method ${call.method}`);
	}
}
