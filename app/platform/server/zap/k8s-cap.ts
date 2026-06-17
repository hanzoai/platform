// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// k8s-cap.ts — the native @zap-proto/web K8s capability.
//
// Binary-ZAP replacement for the tRPC `k8sRouter` (server/api/routers/k8s.ts).
// Every method was `protectedProcedure`, so the mint boundary requires
// session+user (a null return rejects the WS upgrade with HTTP 401); there are
// no per-method org/ownership checks to port. Inputs ride the shared Args
// carrier, results the shared Result carrier; K8sMethod ordinals are generated
// from k8s.zap. Each dispatch case runs the very same service function the tRPC
// procedure ran, with the same arguments and the same return shape.

import type { IncomingMessage } from "node:http";
import {
	type ApplicationSpec,
	deployApplication,
	deployStack,
	getApplicationLogs,
	getApplicationStatus,
	teardownApplication,
} from "@hanzo/platform/services/k8s";
import { validateRequest } from "@hanzo/platform/lib/auth";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { K8sMethod } from "./schema/k8s_zap";

/** Per-connection auth context — the minted value `serve()` threads into rootCap. */
export interface K8sCtx {
	organizationId: string;
	userRole: "owner" | "member" | "admin";
	userId: string;
}

/**
 * k8sMintCap — bearer→ctx boundary. Replaces `protectedProcedure`: validates the
 * upgrade request (session cookie / x-api-key) and returns the typed ctx. Null →
 * the upgrade is rejected with HTTP 401 before any WebSocket opens.
 */
export const k8sMintCap: MintCap<K8sCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const organizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const userRole = ((user as { role?: string }).role ??
		"member") as K8sCtx["userRole"];
	const userId = (user as { id?: string }).id || "";
	return { organizationId, userRole, userId };
};

/** Typed internal failure → ZAP Status.Internal. */
class InternalError extends Error {}

/**
 * k8sRootCap — dispatch each decoded Call by K8sMethod ordinal to the same K8s
 * service function the tRPC procedure ran. Inputs decode via the shared Args
 * carrier; results encode via the shared Result carrier. The original bodies
 * wrapped every service call in a try/catch that rethrew an
 * INTERNAL_SERVER_ERROR with a `K8s <op> failed: <msg>` message — preserved here
 * as InternalError → Status.Internal.
 */
export function k8sRootCap(_ctx: K8sCtx): CallHandler {
	return async (call: Call): Promise<Response> => {
		try {
			const value = await dispatch(call);
			return {
				status: Status.OK,
				promiseID: call.promiseID,
				body: encodeResult(value),
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : "internal error";
			return {
				status: Status.Internal,
				promiseID: call.promiseID,
				body: encodeResult({ error: message }),
			};
		}
	};
}

async function dispatch(call: Call): Promise<unknown> {
	switch (call.method) {
		case K8sMethod.deploy: {
			const input = decodeArgs<{
				namespace: string;
				spec: ApplicationSpec;
				kubeconfig?: string;
			}>(call.payload);
			try {
				await deployApplication(input.namespace, input.spec, input.kubeconfig);
				return {
					ok: true,
					namespace: input.namespace,
					name: input.spec.name,
				};
			} catch (err) {
				throw new InternalError(`K8s deploy failed: ${(err as Error).message}`);
			}
		}
		case K8sMethod.teardown: {
			const input = decodeArgs<{
				namespace: string;
				name: string;
				kubeconfig?: string;
			}>(call.payload);
			try {
				await teardownApplication(
					input.namespace,
					input.name,
					input.kubeconfig,
				);
				return { ok: true, namespace: input.namespace, name: input.name };
			} catch (err) {
				throw new InternalError(
					`K8s teardown failed: ${(err as Error).message}`,
				);
			}
		}
		case K8sMethod.status: {
			const input = decodeArgs<{
				namespace: string;
				name: string;
				kubeconfig?: string;
			}>(call.payload);
			try {
				const status = await getApplicationStatus(
					input.namespace,
					input.name,
					input.kubeconfig,
				);
				return { ok: true, status };
			} catch (err) {
				throw new InternalError(`K8s status failed: ${(err as Error).message}`);
			}
		}
		case K8sMethod.logs: {
			const input = decodeArgs<{
				namespace: string;
				name: string;
				tailLines?: number;
				container?: string;
				previous?: boolean;
				kubeconfig?: string;
			}>(call.payload);
			try {
				const logs = await getApplicationLogs(input.namespace, input.name, {
					tailLines: input.tailLines,
					container: input.container,
					previous: input.previous,
					kubeconfig: input.kubeconfig,
				});
				return { ok: true, logs };
			} catch (err) {
				throw new InternalError(`K8s logs failed: ${(err as Error).message}`);
			}
		}
		case K8sMethod.deployStack: {
			const input = decodeArgs<{
				namespace: string;
				stack: string;
				iid: string;
				overrides?: Record<string, unknown>;
				kubeconfig?: string;
			}>(call.payload);
			try {
				await deployStack(
					input.namespace,
					input.stack,
					{ iid: input.iid, ...(input.overrides ?? {}) } as Parameters<
						typeof deployStack
					>[2],
					input.kubeconfig,
				);
				return { ok: true, namespace: input.namespace, stack: input.stack };
			} catch (err) {
				throw new InternalError(
					`K8s stack deploy failed: ${(err as Error).message}`,
				);
			}
		}
		default:
			throw new InternalError(`unknown method ${call.method}`);
	}
}
