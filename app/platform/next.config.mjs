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
		// The /v1/* surface is served NATIVELY by App Router route handlers under
		// app/v1/** — the URL IS the file path, with no rewrite indirection. The
		// only rewrite is the apps-lifecycle drift board: the canonical
		// `platform.hanzo.ai/apps` (docs/APPS_LIFECYCLE.md §6) maps onto the page
		// that lives under the dashboard layout.
		//
		// In frontend-only mode there is no local backend, so proxy the /v1/*
		// surface straight to the production platform.
		if (process.env.SKIP_ENV_VALIDATION === "1") {
			const target = process.env.PLATFORM_API_URL || "https://platform.hanzo.ai";
			return [
				{ source: "/v1/:path*", destination: `${target}/v1/:path*` },
				{ source: "/apps", destination: "/dashboard/apps" },
			];
		}

		return [{ source: "/apps", destination: "/dashboard/apps" }];
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
