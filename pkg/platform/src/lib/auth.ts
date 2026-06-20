import type { IncomingMessage } from "node:http";
import { sso } from "@better-auth/sso";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { admin, apiKey, organization } from "better-auth/plugins";
import { and, desc, eq } from "drizzle-orm";
import { IS_CLOUD } from "../constants";
import { db } from "../db";
import * as schema from "../db/schema";
import { getUserByToken } from "../services/admin";
import {
	getWebServerSettings,
	updateWebServerSettings,
} from "../services/web-server-settings";
import { sendEmail } from "../verification/send-verification-email";
import { getPublicIpWithFallback } from "../wss/utils";
import { getIamServerSession, upsertUserFromIam } from "./iam";

// Better Auth survives ONLY as the host for the api-key / organization / sso
// plugins (Stage 2/3 still rely on them). Identity itself is Hanzo IAM —
// there is no platform-local login (no email/password, no GitHub/Google, no
// generic-oauth). See ./iam and IAM_MIGRATION.md.
const { handler, api } = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "https://platform.hanzo.ai",
	// Residual Better Auth (api-key / organization / sso plugins only) keeps its
	// own /v1/auth namespace — the authClient calls it. Hanzo IAM identity lives
	// on /v1/iam/*, which the @hanzo/iam SDK drives. Never /api/.
	basePath: "/v1/auth",
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	appName: "Hanzo",
	logger: {
		disabled: process.env.NODE_ENV === "production",
	},
	...(!IS_CLOUD && {
		async trustedOrigins() {
			const settings = await getWebServerSettings();

			if (settings) {
				return [
					...(settings.serverIp ? [`http://${settings.serverIp}:3000`] : []),
					...(settings.host ? [`https://${settings.host}`] : []),
				];
			}
			return [];
		},
	}),
	// No emailAndPassword / emailVerification: identity is Hanzo IAM. The
	// platform never hashes a password nor sends a verification mail.
	databaseHooks: {
		user: {
			create: {
				before: async (_user, context) => {
					if (!IS_CLOUD) {
						// Allow OAuth/SSO users through (they arrive via the
						// generic-oauth callback, not the signup form).
						const isOAuthCallback =
							context?.request?.url?.includes("/callback/") ||
							context?.request?.url?.includes("/oauth2/");
						if (isOAuthCallback) {
							return;
						}

						const xHanzoToken =
							context?.request?.headers?.get("x-platform-token");
						if (xHanzoToken) {
							const user = await getUserByToken(xHanzoToken);
							if (!user) {
								throw new APIError("BAD_REQUEST", {
									message: "User not found",
								});
							}
						} else {
							const isAdminPresent = await db.query.member.findFirst({
								where: eq(schema.member.role, "owner"),
							});
							if (isAdminPresent) {
								throw new APIError("BAD_REQUEST", {
									message: "Admin is already created",
								});
							}
						}
					}
				},
				after: async (user) => {
					const isAdminPresent = await db.query.member.findFirst({
						where: eq(schema.member.role, "owner"),
					});

					if (!IS_CLOUD) {
						await updateWebServerSettings({
							serverIp: await getPublicIpWithFallback(),
						});
					}

					if (IS_CLOUD || !isAdminPresent) {
						await db.transaction(async (tx) => {
							const organization = await tx
								.insert(schema.organization)
								.values({
									name: "My Organization",
									ownerId: user.id,
									createdAt: new Date(),
								})
								.returning()
								.then((res) => res[0]);

							await tx.insert(schema.member).values({
								userId: user.id,
								organizationId: organization?.id || "",
								role: "owner",
								createdAt: new Date(),
							});
						});
					}
				},
			},
		},
		session: {
			create: {
				before: async (session) => {
					const member = await db.query.member.findFirst({
						where: eq(schema.member.userId, session.userId),
						orderBy: desc(schema.member.createdAt),
						with: {
							organization: true,
						},
					});

					return {
						data: {
							...session,
							activeOrganizationId: member?.organization.id,
						},
					};
				},
			},
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 3,
		updateAge: 60 * 60 * 24,
	},
	user: {
		modelName: "users_temp",
		additionalFields: {
			role: {
				type: "string",
				// required: true,
				input: false,
			},
			ownerId: {
				type: "string",
				// required: true,
				input: false,
			},
			allowImpersonation: {
				fieldName: "allowImpersonation",
				type: "boolean",
				defaultValue: false,
			},
		},
	},
	plugins: [
		apiKey({
			enableMetadata: true,
		}),
		sso(),
		// twoFactor(), // Disabled due to better-auth bug: "Body is not allowed with GET or HEAD methods"
		organization({
			async sendInvitationEmail(data, _request) {
				if (IS_CLOUD) {
					const host =
						process.env.NODE_ENV === "development"
							? "http://localhost:3000"
							: "https://app.hanzo.ai";
					const inviteLink = `${host}/invitation?token=${data.id}`;

					await sendEmail({
						email: data.email,
						subject: "Invitation to join organization",
						text: `
					<p>You are invited to join ${data.organization.name} on Hanzo. Click the link to accept the invitation: <a href="${inviteLink}">Accept Invitation</a></p>
					`,
					});
				}
			},
		}),
		// IAM login no longer rides Better Auth's generic-oauth: the browser
		// drives the @hanzo/iam PKCE flow directly and validateRequest verifies
		// the resulting token. See ./iam.
		...(IS_CLOUD
			? [
					admin({
						adminUserIds: [process.env.USER_ADMIN_ID as string],
					}),
				]
			: []),
	],
});

export const auth = {
	handler,
	createApiKey: api.createApiKey,
	registerSSOProvider: api.registerSSOProvider,
	updateSSOProvider: api.updateSSOProvider,
};

export type { PlatformSession } from "./iam";
// IAM is the identity surface; re-export from the single auth entry point so
// consumers import auth helpers from one place (@hanzo/platform/lib/auth).
export { getIamServerSession, upsertUserFromIam } from "./iam";

export const validateRequest = async (request: IncomingMessage) => {
	const apiKey = request.headers["x-api-key"] as string;
	if (apiKey) {
		try {
			const { valid, key, error } = await api.verifyApiKey({
				body: {
					key: apiKey,
				},
			});

			if (error) {
				throw new Error(error.message?.toString() || "Error verifying API key");
			}
			if (!valid || !key) {
				return {
					session: null,
					user: null,
				};
			}

			const apiKeyRecord = await db.query.apikey.findFirst({
				where: eq(schema.apikey.id, key.id),
				with: {
					user: true,
				},
			});

			if (!apiKeyRecord) {
				return {
					session: null,
					user: null,
				};
			}

			const organizationId = JSON.parse(
				apiKeyRecord.metadata || "{}",
			).organizationId;

			if (!organizationId) {
				return {
					session: null,
					user: null,
				};
			}

			const member = await db.query.member.findFirst({
				where: and(
					eq(schema.member.userId, apiKeyRecord.user.id),
					eq(schema.member.organizationId, organizationId),
				),
				with: {
					organization: true,
				},
			});

			const {
				id,
				firstName,
				lastName,
				email,
				emailVerified,
				image,
				createdAt,
				updatedAt,
				twoFactorEnabled,
			} = apiKeyRecord.user;
			const name = [firstName, lastName].filter(Boolean).join(" ");

			const mockSession = {
				session: {
					userId: apiKeyRecord.user.id,
					activeOrganizationId: organizationId || "",
				},
				user: {
					id,
					name,
					email,
					emailVerified,
					image,
					createdAt,
					updatedAt,
					twoFactorEnabled,
					role: member?.role || "member",
					ownerId: member?.organization.ownerId || apiKeyRecord.user.id,
				},
			};

			return mockSession;
		} catch (error) {
			console.error("Error verifying API key", error);
			return {
				session: null,
				user: null,
			};
		}
	}

	// No API key: identity comes from Hanzo IAM. Verify the IAM access token
	// (Bearer header or hanzo_iam_access_token cookie) against hanzo.id's
	// JWKS, then resolve it onto the local user/member/organization rows so the
	// returned shape stays identical for every caller.
	const identity = await getIamServerSession(request);
	if (!identity) {
		return {
			session: null,
			user: null,
		};
	}

	return upsertUserFromIam(identity);
};
