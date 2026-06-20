import { ssoClient } from "@better-auth/sso/client";
import {
	adminClient,
	apiKeyClient,
	genericOAuthClient,
	inferAdditionalFields,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
	basePath: "/v1/auth", // canonical /v1/ — never /api/
	plugins: [
		organizationClient(),
		twoFactorClient(),
		apiKeyClient(),
		ssoClient(),
		adminClient(),
		genericOAuthClient(),
		inferAdditionalFields({
			user: {
				lastName: {
					type: "string",
				},
			},
		}),
	],
});
