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
		const canonical = [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];

		// In frontend-only mode, also proxy API calls to the production platform.
		if (process.env.SKIP_ENV_VALIDATION === "1") {
			const target = process.env.PLATFORM_API_URL || "https://platform.hanzo.ai";
			return [
				...canonical,
				{ source: "/api/:path*", destination: `${target}/api/:path*` },
			];
		}

		return canonical;
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
