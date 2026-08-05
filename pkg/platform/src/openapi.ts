/**
 * The OpenAPI surface for the tRPC `/v1` REST mirror.
 *
 * This is the ONE way to reach the vendored `trpc-openapi` (see
 * `./vendor/trpc-openapi/README.md`). Import from `@hanzo/platform/openapi`;
 * never from `vendor/*`. Keeping the vendored tree behind a single re-export
 * is what makes re-syncing it — or one day deleting it, once the last tRPC
 * router is gone and `openapi.zap.json` is the only generated document — a
 * change to this file rather than to every call site.
 */
export {
	createOpenApiFetchHandler,
	generateOpenApiDocument,
	type OpenApiMeta,
	type OpenApiRouter,
} from "./vendor/trpc-openapi";
