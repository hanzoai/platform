import { ssoClient } from "@better-auth/sso/client";
import {
	adminClient,
	apiKeyClient,
	inferAdditionalFields,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

// No genericOAuthClient: identity is Hanzo IAM via the @hanzo/iam PKCE flow
// (HIP-0111), not Better Auth generic-oauth. The residual Better Auth client
// hosts only the api-key / organization / sso / admin plugins.
export const authClient = createAuthClient({
	basePath: "/v1/auth", // canonical /v1/ — never /api/
	plugins: [
		organizationClient(),
		twoFactorClient(),
		apiKeyClient(),
		ssoClient(),
		adminClient(),
		inferAdditionalFields({
			user: {
				lastName: {
					type: "string",
				},
			},
		}),
	],
});
