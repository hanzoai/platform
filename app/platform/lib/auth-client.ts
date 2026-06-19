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
	// baseURL: "http://localhost:3000", // the base url of your auth server
	// Must match the server basePath (pkg/platform/src/lib/auth.ts) so the
	// client calls /v1/auth/* instead of the Better Auth default /api/auth/*.
	basePath: "/v1/auth",
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
