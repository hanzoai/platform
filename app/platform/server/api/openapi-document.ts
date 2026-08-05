import { generateOpenApiDocument } from "@hanzo/platform/openapi";
import packageInfo from "../../package.json";
import { appRouter } from "./root";

/**
 * The ONE OpenAPI document for the `/v1` REST surface.
 *
 * It was built in three places — `scripts/generate-openapi.ts`,
 * the `settings.getOpenApiDocument` tRPC procedure, and the
 * `SettingsMethod.getOpenApiDocument` ZAP cap — each with its own copy of the
 * tag list. They had already drifted from each other: the script was missing
 * nine tags the other two had (auditLog, customRole, libsql, licenseKey,
 * patch, previewDeployment, sso, tag, whitelabeling) and carried three they
 * did not (rollback, schedule, swarm). None of the three is kept — the list
 * is derived from the router now; see `openApiTags`.
 *
 * The drift was not only in the tags. All three declared the `x-api-key`
 * scheme, but the two runtime copies published a bare `info` (title,
 * one-line description, version) and no `externalDocs`, while the script
 * published contact and license metadata and a documentation link. So the
 * document you fetched from a running instance and the `openapi.json` the
 * docs site serves described the same API differently. Building the whole
 * document here — not just the tag list — is what makes it a single fact.
 */
/**
 * The tags the document declares — derived, never hand-written.
 *
 * trpc-openapi tags each operation with the first segment of its procedure
 * path (`utils/procedure.ts`: `tags: [path.split(".")[0] ?? "default"]`), i.e.
 * the name of the router it is mounted under. So the document's tag
 * declarations are not a matter of taste: they ARE the mounted router names,
 * and any list typed out by hand is a copy of something the router already
 * knows.
 *
 * Every copy of that list had gone stale in both directions. It declared five
 * tags for routers that no longer exist — `ai`, `cluster`, `destination`,
 * `registry` (migrated to ZAP and deleted; see `api/root.ts` tombstones) and
 * `sshRouter` (renamed `sshKey`) — and omitted seven routers that are mounted
 * right now: billing, buildJob, dedicatedCluster, deployProvider,
 * notification, sshKey, stripe. Their operations were tagged with a group the
 * document never declared.
 *
 * Computed on CALL, never at module load. `root.ts` imports the settings
 * router, which imports this module, so reading `appRouter` while this module
 * is being evaluated hits the binding in its temporal dead zone — a webpack
 * production build fails collecting page data with "Cannot access 'aa' before
 * initialization". By the time anyone asks for a document, the graph is built.
 */
export function openApiTags(): string[] {
	return [
		...new Set(
			Object.keys(appRouter._def.procedures).map(
				(path) => path.split(".")[0] ?? "default",
			),
		),
	].sort();
}

export interface OpenApiDocumentOptions {
	/** Origin + mount the operations hang off, e.g. `https://host/v1`. */
	baseUrl: string;
}

export function buildOpenApiDocument({ baseUrl }: OpenApiDocumentOptions) {
	const document = generateOpenApiDocument(appRouter, {
		title: "Hanzo Platform API",
		version: packageInfo.version,
		baseUrl,
		docsUrl: "https://docs.hanzo.ai",
		tags: openApiTags(),
	});

	document.info = {
		title: "Hanzo Platform API",
		description:
			"Complete API documentation for Hanzo Platform - Deploy applications, manage databases, and orchestrate your infrastructure. This API allows you to programmatically manage all aspects of your Hanzo Platform instance.",
		version: packageInfo.version,
		contact: {
			name: "Hanzo Platform Team",
			url: "https://hanzo.ai",
		},
		license: {
			name: "Apache 2.0",
			url: "https://github.com/hanzoai/platform/blob/main/LICENSE.MD",
		},
	};

	document.components = {
		...document.components,
		securitySchemes: {
			apiKey: {
				type: "apiKey",
				in: "header",
				name: "x-api-key",
				description:
					"API key authentication. Generate an API key from your Hanzo Platform dashboard under Settings > API Keys.",
			},
		},
	};

	document.security = [{ apiKey: [] }];

	document.externalDocs = {
		description: "Full documentation",
		url: "https://docs.hanzo.ai",
	};

	return document;
}

/**
 * The document as served by a running instance, for a request that arrived on
 * `host` over `protocol`.
 *
 * `/v1` is where the REST surface actually mounts (`app/v1/[...openapi]/route.ts`
 * passes `endpoint: "/v1"`). Both runtime callers previously advertised
 * `<host>/api`, so every client generated from the live document called a
 * prefix this app does not serve — and `/api` is not a prefix we use anywhere.
 */
export function buildOpenApiDocumentForRequest(
	protocol: string | undefined,
	host: string | undefined,
) {
	return buildOpenApiDocument({
		baseUrl: `${protocol ?? "https"}://${host ?? "platform.hanzo.ai"}/v1`,
	});
}
