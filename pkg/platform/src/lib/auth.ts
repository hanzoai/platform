import type { IncomingMessage } from "node:http";
import * as bcrypt from "bcrypt";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { sso } from "@better-auth/sso";
import { admin, apiKey, organization, genericOAuth } from "better-auth/plugins";
import { iamProvider } from "@hanzo/iam/betterauth";
import { and, desc, eq } from "drizzle-orm";
import { IS_CLOUD } from "../constants";
import { db } from "../db";
import * as schema from "../db/schema";
import { getUserByToken } from "../services/admin";
import { updateUser } from "../services/user";
import {
	getWebServerSettings,
	updateWebServerSettings,
} from "../services/web-server-settings";
import { sendEmail } from "../verification/send-verification-email";
import { getPublicIpWithFallback } from "../wss/utils";

// IAM OIDC configuration (prefer IAM_* env vars)
const IAM_URL = (
	process.env.IAM_URL ||
	process.env.IAM_ENDPOINT ||
	process.env.HANZO_IAM_URL ||
	process.env.HANZO_IAM_ENDPOINT ||
	process.env.HANZO_IAM_SERVER_URL ||
	"https://iam.hanzo.ai"
).replace(/\/$/, "");
const IAM_CLIENT_ID =
	process.env.IAM_CLIENT_ID ||
	process.env.HANZO_IAM_CLIENT_ID ||
	process.env.HANZO_CLIENT_ID;
const IAM_CLIENT_SECRET =
	process.env.IAM_CLIENT_SECRET ||
	process.env.HANZO_IAM_CLIENT_SECRET ||
	process.env.HANZO_CLIENT_SECRET;

const { handler, api } = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || "https://platform.hanzo.ai",
	basePath: "/v1/auth", // canonical /v1/ — never /api/
	database: drizzleAdapter(db, {
		provider: "pg",
		schema: schema,
	}),
	appName: "Hanzo",
	socialProviders: {
		github: {
			clientId: process.env.GITHUB_CLIENT_ID as string,
			clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
		},
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID as string,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
		},
	},
	logger: {
		disabled: process.env.NODE_ENV === "production",
	},
	...(!IS_CLOUD && {
		async trustedOrigins() {
			const settings = await getWebServerSettings();

			if (settings) {
				return [
					...(settings.serverIp
						? [`http://${settings.serverIp}:3000`]
						: []),
					...(settings.host ? [`https://${settings.host}`] : []),
				];
			}
			return [];
		},
	}),
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => {
			if (IS_CLOUD) {
				await sendEmail({
					email: user.email,
					subject: "Verify your email",
					text: `
				<p>Click the link to verify your email: <a href="${url}">Verify Email</a></p>
				`,
				});
			}
		},
	},
	emailAndPassword: {
		enabled: true,
		autoSignIn: !IS_CLOUD,
		requireEmailVerification: IS_CLOUD,
		password: {
			async hash(password) {
				return bcrypt.hashSync(password, 10);
			},
			async verify({ hash, password }) {
				return bcrypt.compareSync(password, hash);
			},
		},
		sendResetPassword: async ({ user, url }) => {
			await sendEmail({
				email: user.email,
				subject: "Reset your password",
				text: `
				<p>Click the link to reset your password: <a href="${url}">Reset Password</a></p>
				`,
			});
		},
	},
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
		// Hanzo IAM OIDC provider
		...(IAM_CLIENT_ID && IAM_CLIENT_SECRET
			? [
					genericOAuth({
						config: [
							iamProvider({
								serverUrl: IAM_URL,
								clientId: IAM_CLIENT_ID as string,
								clientSecret: IAM_CLIENT_SECRET as string,
							}),
						],
					}),
				]
			: []),
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

	// If no API key, proceed with normal session validation
	const session = await api.getSession({
		headers: new Headers({
			cookie: request.headers.cookie || "",
		}),
	});

	if (!session?.session || !session.user) {
		return {
			session: null,
			user: null,
		};
	}

	// TypeScript now knows session and session.user are not null
	// But we need to help it understand with non-null assertions
	const member = await db.query.member.findFirst({
		where: and(
			eq(schema.member.userId, session.user!.id),
			eq(
				schema.member.organizationId,
				session.session!.activeOrganizationId || "",
			),
		),
		with: {
			organization: true,
		},
	});

	session.user!.role = member?.role || "member";
	if (member) {
		session.user!.ownerId = member.organization.ownerId;
	} else {
		session.user!.ownerId = session.user!.id;
	}

	return session;
};
