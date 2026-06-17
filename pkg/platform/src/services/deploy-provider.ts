import { db } from "@hanzo/platform/db";
import {
	type apiCreateDeployProvider,
	deployProvider,
} from "@hanzo/platform/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";

export type DeployProvider = typeof deployProvider.$inferSelect;

export const createDeployProvider = async (
	input: z.infer<typeof apiCreateDeployProvider>,
	organizationId: string,
) => {
	// If setting as default, unset any existing default for same provider type
	if (input.isDefault) {
		await db
			.update(deployProvider)
			.set({ isDefault: false })
			.where(
				and(
					eq(deployProvider.organizationId, organizationId),
					eq(deployProvider.providerType, input.providerType),
					eq(deployProvider.isDefault, true),
				),
			);
	}

	const result = await db
		.insert(deployProvider)
		.values({
			...input,
			organizationId,
		} as typeof deployProvider.$inferInsert)
		.returning()
		.then((rows) => rows[0]);

	if (!result) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Failed to create deploy provider",
		});
	}

	return result;
};

export const findDeployProviderById = async (deployProviderId: string) => {
	const provider = await db.query.deployProvider.findFirst({
		where: eq(deployProvider.deployProviderId, deployProviderId),
	});
	if (!provider) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Deploy provider not found",
		});
	}
	return provider;
};

export const findDeployProvidersByOrg = async (organizationId: string) => {
	return db.query.deployProvider.findMany({
		where: eq(deployProvider.organizationId, organizationId),
		orderBy: (dp, { desc }) => [desc(dp.createdAt)],
	});
};

export const findDefaultDeployProvider = async (
	organizationId: string,
	providerType: DeployProvider["providerType"],
) => {
	return db.query.deployProvider.findFirst({
		where: and(
			eq(deployProvider.organizationId, organizationId),
			eq(deployProvider.providerType, providerType),
			eq(deployProvider.isDefault, true),
		),
	});
};

export const updateDeployProviderById = async (
	deployProviderId: string,
	organizationId: string,
	data: Partial<DeployProvider>,
) => {
	// If setting as default, unset any existing default for same provider type
	if (data.isDefault && data.providerType) {
		await db
			.update(deployProvider)
			.set({ isDefault: false })
			.where(
				and(
					eq(deployProvider.organizationId, organizationId),
					eq(deployProvider.providerType, data.providerType),
					eq(deployProvider.isDefault, true),
				),
			);
	}

	const result = await db
		.update(deployProvider)
		.set({ ...data, updatedAt: new Date() })
		.where(
			and(
				eq(deployProvider.deployProviderId, deployProviderId),
				eq(deployProvider.organizationId, organizationId),
			),
		)
		.returning()
		.then((rows) => rows[0]);

	return result;
};

export const removeDeployProviderById = async (
	deployProviderId: string,
	organizationId: string,
) => {
	const result = await db
		.delete(deployProvider)
		.where(
			and(
				eq(deployProvider.deployProviderId, deployProviderId),
				eq(deployProvider.organizationId, organizationId),
			),
		)
		.returning()
		.then((rows) => rows[0]);

	return result;
};

/**
 * Resolve Cloudflare credentials for a given org.
 * Falls back to env vars if no org-level provider is configured.
 */
export const resolveCloudflareCredentials = async (
	organizationId: string,
): Promise<{ apiToken: string; accountId: string }> => {
	const provider = await findDefaultDeployProvider(
		organizationId,
		"cloudflare-pages",
	);

	if (provider?.apiToken && provider?.accountId) {
		return {
			apiToken: provider.apiToken,
			accountId: provider.accountId,
		};
	}

	// Fall back to environment variables
	const apiToken = process.env.CLOUDFLARE_API_TOKEN;
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;

	if (!apiToken || !accountId) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"No Cloudflare credentials configured. Add a deploy provider in Settings or set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID environment variables.",
		});
	}

	return { apiToken, accountId };
};

/**
 * Resolve Vercel credentials for a given org.
 */
export const resolveVercelCredentials = async (
	organizationId: string,
): Promise<{ token: string; teamId?: string }> => {
	const provider = await findDefaultDeployProvider(organizationId, "vercel");

	if (provider?.apiToken) {
		const extra = provider.credentialsJson
			? JSON.parse(provider.credentialsJson)
			: {};
		return {
			token: provider.apiToken,
			teamId: extra.teamId,
		};
	}

	const token = process.env.VERCEL_TOKEN;
	if (!token) {
		throw new TRPCError({
			code: "PRECONDITION_FAILED",
			message:
				"No Vercel credentials configured. Add a deploy provider in Settings or set VERCEL_TOKEN environment variable.",
		});
	}

	return { token, teamId: process.env.VERCEL_TEAM_ID };
};

/**
 * Test connectivity for a deploy provider.
 * Returns true on success, throws on failure.
 */
export const testDeployProviderConnection = async (
	provider: DeployProvider,
): Promise<{ success: boolean; message: string }> => {
	switch (provider.providerType) {
		case "cloudflare-pages": {
			if (!provider.apiToken || !provider.accountId) {
				return {
					success: false,
					message: "Missing apiToken or accountId",
				};
			}
			const res = await fetch(
				`https://api.cloudflare.com/client/v4/accounts/${provider.accountId}/pages/projects`,
				{
					headers: {
						Authorization: `Bearer ${provider.apiToken}`,
					},
				},
			);
			const data = await res.json() as { success: boolean; errors?: Array<{ message: string }> };
			if (data.success) {
				return {
					success: true,
					message: "Cloudflare Pages connection successful",
				};
			}
			return {
				success: false,
				message: `Cloudflare API error: ${data.errors?.[0]?.message || res.statusText}`,
			};
		}
		case "vercel": {
			if (!provider.apiToken) {
				return { success: false, message: "Missing API token" };
			}
			const res = await fetch("https://api.vercel.com/v2/user", {
				headers: { Authorization: `Bearer ${provider.apiToken}` },
			});
			if (res.ok) {
				return { success: true, message: "Vercel connection successful" };
			}
			return {
				success: false,
				message: `Vercel API error: ${res.statusText}`,
			};
		}
		case "netlify": {
			if (!provider.apiToken) {
				return { success: false, message: "Missing API token" };
			}
			const res = await fetch("https://api.netlify.com/api/v1/user", {
				headers: { Authorization: `Bearer ${provider.apiToken}` },
			});
			if (res.ok) {
				return { success: true, message: "Netlify connection successful" };
			}
			return {
				success: false,
				message: `Netlify API error: ${res.statusText}`,
			};
		}
		default:
			return {
				success: true,
				message: `Provider type "${provider.providerType}" connectivity not verified`,
			};
	}
};
