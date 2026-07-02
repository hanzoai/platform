/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */

/** @type {import("next").NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	typescript: {
		ignoreBuildErrors: true,
	},
	transpilePackages: ["@hanzo/platform", "@hanzo/ui"],
	async rewrites() {
		// Canonical request path is /v1/* (no /api/ prefix, per platform convention).
		// The Next.js pages router physically serves these handlers under /api/v1/*,
		// so map the canonical path onto the physical one at request time. Both
		// /v1/* and /api/v1/* resolve to the same handler.
		//
		// The apps-lifecycle drift view is documented at the top-level
		// `platform.hanzo.ai/apps` (docs/APPS_LIFECYCLE.md §6); the page itself
		// lives under the dashboard layout, so map the canonical URL onto it.
		// In frontend-only mode there is no local backend, so proxy the canonical
		// /v1/* surface straight to the production platform. This must precede the
		// local /v1 → /api/v1 rewrite so it wins the match.
		if (process.env.SKIP_ENV_VALIDATION === "1") {
			const target = process.env.PLATFORM_API_URL || "https://platform.hanzo.ai";
			return [
				{ source: "/v1/:path*", destination: `${target}/v1/:path*` },
				{ source: "/apps", destination: "/dashboard/apps" },
			];
		}

		return [
			{ source: "/v1/:path*", destination: "/api/v1/:path*" },
			{ source: "/apps", destination: "/dashboard/apps" },
		];
	},
	async headers() {
		return [
			{
				// Apply security headers to all routes
				source: "/:path*",
				headers: [
					{
						key: "X-Frame-Options",
						value: "DENY",
					},
					{
						key: "Content-Security-Policy",
						value: "frame-ancestors 'none'",
					},
					{
						key: "X-Content-Type-Options",
						value: "nosniff",
					},
					{
						key: "Referrer-Policy",
						value: "strict-origin-when-cross-origin",
					},
				],
			},
		];
	},
};

export default nextConfig;
