// Copyright (C) 2025, Lux Industries Inc. All rights reserved.
//
// ai-cap.ts — the native @zap-proto/web AI capability.
//
// Binary-ZAP replacement for the tRPC `aiRouter` (server/api/routers/ai.ts):
//   - aiMintCap:  bearer→ctx boundary at the WS upgrade. Mirrors the tRPC
//                 procedures' gating: a session+user is required (replaces
//                 `protectedProcedure`); a null return rejects the upgrade with
//                 HTTP 401. Per-method admin gating (the `adminProcedure`
//                 methods) is enforced in dispatch via requireAdmin(ctx).
//   - aiRootCap:  rootCap(ctx) → CallHandler. Dispatches each decoded ZAP Call
//                 by its method ordinal (AiMethod, generated from ai.zap) to the
//                 same service functions the tRPC procedure called, with the
//                 same arguments and the same error throws.
//
// Inputs ride the shared Args carrier (decodeArgs); results the shared Result
// carrier (encodeResult). The AiMethod ordinal table is generated from ai.zap.

import type { IncomingMessage } from "node:http";
import { IS_CLOUD } from "@hanzo/platform/constants";
import {
	createDomain,
	createMount,
	findEnvironmentById,
} from "@hanzo/platform/index";
import { validateRequest } from "@hanzo/platform/lib/auth";
import {
	deleteAiSettings,
	getAiSettingById,
	getAiSettingsByOrganizationId,
	saveAiSettings,
	suggestVariants,
} from "@hanzo/platform/services/ai";
import { createComposeByTemplate } from "@hanzo/platform/services/compose";
import { findProjectById } from "@hanzo/platform/services/project";
import {
	addNewService,
	checkServiceAccess,
} from "@hanzo/platform/services/user";
import {
	getProviderHeaders,
	getProviderName,
	type Model,
	selectAIProvider,
} from "@hanzo/platform/utils/ai/select-ai-provider";
import type { CallHandler } from "@zap-proto/web";
import type { MintCap } from "@zap-proto/web/auth";
import type { Call, Response } from "@zap-proto/zap";
import { Status } from "@zap-proto/zap";
import { generateText } from "ai";
import { slugify } from "@/lib/slug";
import { generatePassword } from "@/templates/utils";
import { decodeArgs } from "./args";
import { encodeResult } from "./result";
import { AiMethod } from "./schema/ai_zap";

/**
 * Per-connection auth context — the tRPC ctx shape the ported service calls
 * expect (`ctx.session.activeOrganizationId`, and `ctx` itself for
 * checkServiceAccess / addNewService).
 */
export interface AiCtx {
	session: { activeOrganizationId: string };
	user: { id: string; role: "owner" | "member" | "admin" };
}

/** Typed errors → ZAP status codes (mirror the tRPC error codes). */
class BadRequestError extends Error {}
class ForbiddenError extends Error {}
class UnauthorizedError extends Error {}

/** Admin gate — mirrors `adminProcedure` (owner|admin only). */
function requireAdmin(ctx: AiCtx): void {
	if (ctx.user.role !== "owner" && ctx.user.role !== "admin") {
		throw new UnauthorizedError("admin role required");
	}
}

/**
 * aiMintCap — bearer→ctx boundary. Requires a session+user (mirrors
 * `protectedProcedure`); null → HTTP 401 before any socket opens. Admin-only
 * methods are gated per-call in dispatch.
 */
export const aiMintCap: MintCap<AiCtx> = async (req: IncomingMessage) => {
	const { session, user } = await validateRequest(req);
	if (!session || !user) return null;
	const activeOrganizationId =
		(session as { activeOrganizationId?: string }).activeOrganizationId || "";
	const role = ((user as { role?: string }).role ??
		"member") as AiCtx["user"]["role"];
	return {
		session: { activeOrganizationId },
		user: { id: (user as { id: string }).id, role },
	};
};

/**
 * aiRootCap — the connection's dispatch root. For each decoded Call, decode the
 * input via the shared Args carrier, run the matching service function (the very
 * same one the tRPC procedure ran), and encode the result. Errors map to ZAP
 * status codes, never a thrown HTTP 500 leak.
 */
export function aiRootCap(ctx: AiCtx): CallHandler {
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
				err instanceof ForbiddenError
					? Status.Forbidden
					: err instanceof UnauthorizedError
						? Status.Unauthorized
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

async function dispatch(ctx: AiCtx, call: Call): Promise<unknown> {
	switch (call.method) {
		case AiMethod.one: {
			requireAdmin(ctx);
			const input = decodeArgs<{ aiId: string }>(call.payload);
			return await getAiSettingById(input.aiId);
		}

		case AiMethod.getModels: {
			const input = decodeArgs<{ apiUrl: string; apiKey: string }>(
				call.payload,
			);
			try {
				const providerName = getProviderName(input.apiUrl);
				const headers = getProviderHeaders(input.apiUrl, input.apiKey);
				let response = null;
				switch (providerName) {
					case "ollama":
						response = await fetch(`${input.apiUrl}/api/tags`, { headers });
						break;
					case "gemini":
						response = await fetch(
							`${input.apiUrl}/models?key=${encodeURIComponent(input.apiKey)}`,
							{ headers: {} },
						);
						break;
					case "perplexity":
						// Perplexity doesn't have a /models endpoint, return hardcoded list
						return [
							{
								id: "sonar-deep-research",
								object: "model",
								created: Date.now(),
								owned_by: "perplexity",
							},
							{
								id: "sonar-reasoning-pro",
								object: "model",
								created: Date.now(),
								owned_by: "perplexity",
							},
							{
								id: "sonar-reasoning",
								object: "model",
								created: Date.now(),
								owned_by: "perplexity",
							},
							{
								id: "sonar-pro",
								object: "model",
								created: Date.now(),
								owned_by: "perplexity",
							},
							{
								id: "sonar",
								object: "model",
								created: Date.now(),
								owned_by: "perplexity",
							},
						] as Model[];
					// PRE-EXISTING: the fork's getProviderName union has no
					// "zai"/"minimax" arms (select-ai-provider.ts only knows the
					// upstream providers), so those template branches are dropped —
					// they fall through to the default /models fetch like any
					// unrecognized custom endpoint.
					default:
						if (!input.apiKey)
							throw new BadRequestError(
								"API key must contain at least 1 character(s)",
							);
						response = await fetch(`${input.apiUrl}/models`, { headers });
				}

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Failed to fetch models: ${errorText}`);
				}

				const res = await response.json();

				if (Array.isArray(res)) {
					return res.map((model) => ({
						id: model.id || model.name,
						object: "model",
						created: Date.now(),
						owned_by: "provider",
					}));
				}

				if (res.models) {
					// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
					return res.models.map((model: any) => ({
						id: model.id || model.name,
						object: "model",
						created: Date.now(),
						owned_by: "provider",
					})) as Model[];
				}

				if (res.data) {
					return res.data as Model[];
				}

				const possibleModels =
					// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
					(Object.values(res).find(Array.isArray) as any[]) || [];
				return possibleModels.map((model) => ({
					id: model.id || model.name,
					object: "model",
					created: Date.now(),
					owned_by: "provider",
				})) as Model[];
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error?.message : `Error: ${error}`,
				);
			}
		}

		case AiMethod.create: {
			requireAdmin(ctx);
			const input = decodeArgs(call.payload);
			return await saveAiSettings(ctx.session.activeOrganizationId, input);
		}

		case AiMethod.update: {
			requireAdmin(ctx);
			const input = decodeArgs(call.payload);
			return await saveAiSettings(ctx.session.activeOrganizationId, input);
		}

		case AiMethod.getAll: {
			requireAdmin(ctx);
			return await getAiSettingsByOrganizationId(
				ctx.session.activeOrganizationId,
			);
		}

		case AiMethod.get: {
			requireAdmin(ctx);
			const input = decodeArgs<{ aiId: string }>(call.payload);
			return await getAiSettingById(input.aiId);
		}

		case AiMethod.delete: {
			requireAdmin(ctx);
			const input = decodeArgs<{ aiId: string }>(call.payload);
			return await deleteAiSettings(input.aiId);
		}

		case AiMethod.getEnabledProviders: {
			const settings = await getAiSettingsByOrganizationId(
				ctx.session.activeOrganizationId,
			);
			return settings
				.filter((s) => s.isEnabled)
				.map((s) => ({ aiId: s.aiId, name: s.name, model: s.model }));
		}

		case AiMethod.analyzeLogs: {
			const input = decodeArgs<{
				aiId: string;
				logs: string;
				context: "build" | "runtime";
			}>(call.payload);
			try {
				const aiSettings = await getAiSettingById(input.aiId);
				if (!aiSettings?.isEnabled) {
					throw new BadRequestError("AI provider is not enabled");
				}

				if (aiSettings.organizationId !== ctx.session.activeOrganizationId) {
					throw new ForbiddenError("Access denied");
				}

				const provider = selectAIProvider(aiSettings);
				const model = provider(aiSettings.model);

				const contextLabel =
					input.context === "build" ? "build/deployment" : "runtime/container";

				const result = await generateText({
					model,
					prompt: `You are a DevOps engineer analyzing ${contextLabel} logs. Analyze the following logs and provide:

1. **Summary**: A brief summary of what's happening
2. **Issues Found**: Any errors, warnings, or problems detected
3. **Root Cause**: The most likely root cause if there are errors
4. **Suggested Fix**: Actionable steps to resolve the issues

Be concise and practical. Focus on the most important issues. If the logs look healthy, say so briefly.

Logs:
${input.logs}`,
				});

				return { analysis: result.text };
			} catch (error) {
				if (error instanceof ForbiddenError) throw error;
				throw new BadRequestError(
					error instanceof Error ? error.message : `Analysis failed: ${error}`,
				);
			}
		}

		case AiMethod.testConnection: {
			const input = decodeArgs<{
				apiUrl: string;
				apiKey: string;
				model: string;
			}>(call.payload);
			try {
				const provider = selectAIProvider({
					apiUrl: input.apiUrl,
					apiKey: input.apiKey,
				});
				const model = provider(input.model);
				const result = await generateText({
					model,
					prompt: "Reply with 'ok'",
				});
				if (!result.text) {
					throw new Error("No response received from the model");
				}
				return { success: true, message: "Connection successful" };
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error.message : `Connection failed: ${error}`,
				);
			}
		}

		case AiMethod.suggest: {
			const input = decodeArgs<{
				aiId: string;
				input: string;
				serverId?: string;
			}>(call.payload);
			try {
				return await suggestVariants({
					aiId: input.aiId,
					input: input.input,
					serverId: input.serverId,
					organizationId: ctx.session.activeOrganizationId,
				});
			} catch (error) {
				throw new BadRequestError(
					error instanceof Error ? error?.message : `Error: ${error}`,
				);
			}
		}

		case AiMethod.deploy: {
			// biome-ignore lint/suspicious/noExplicitAny: deploySuggestionSchema input, ported verbatim
			const input = decodeArgs<any>(call.payload);
			const environment = await findEnvironmentById(input.environmentId);
			const project = await findProjectById(environment.projectId);
			await checkServiceAccess(
				ctx.user.id,
				environment.projectId,
				ctx.session.activeOrganizationId,
				"create",
			);

			if (IS_CLOUD && !input.serverId) {
				throw new UnauthorizedError(
					"You need to use a server to create a compose",
				);
			}

			const projectName = slugify(`${project.name} ${input.id}`);

			const compose = await createComposeByTemplate({
				...input,
				composeFile: input.dockerCompose,
				env: input.envVariables,
				serverId: input.serverId,
				name: input.name,
				sourceType: "raw",
				appName: `${projectName}-${generatePassword(6)}`,
				isolatedDeployment: true,
				environmentId: input.environmentId,
				// biome-ignore lint/suspicious/noExplicitAny: ported verbatim
			} as any);

			if (input.domains && input.domains?.length > 0) {
				for (const domain of input.domains) {
					await createDomain({
						...domain,
						domainType: "compose",
						certificateType: "none",
						composeId: compose.composeId,
					});
				}
			}
			if (input.configFiles && input.configFiles?.length > 0) {
				for (const mount of input.configFiles) {
					await createMount({
						filePath: mount.filePath,
						mountPath: "",
						content: mount.content,
						serviceId: compose.composeId,
						serviceType: "compose",
						type: "file",
					});
				}
			}

			await addNewService(
			ctx.user.id,
			compose.composeId,
			ctx.session.activeOrganizationId,
		);

			return null;
		}

		default:
			throw new BadRequestError(`unknown method ${call.method}`);
	}
}
