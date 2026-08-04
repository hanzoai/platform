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
	// @hanzo/ui 8 renders through @hanzo/gui, which ships untranspiled ESM using
	// React-Native module resolution. Next has to compile those packages and point
	// `react-native` at the web implementation — that pair IS the browser story for
	// the gui substrate, and omitting either one fails at bundle time, not at
	// runtime. Same shape hanzo.ai already builds with.
	transpilePackages: [
		"@hanzo/platform",
		"@hanzo/ui",
		"@hanzo/gui",
		"react-native-web",
	],
	webpack: (config) => {
		config.resolve.alias = {
			...config.resolve.alias,
			"react-native$": "react-native-web",
		};
		// gui ships `.web.*` platform variants; without these extensions webpack
		// picks the native file and pulls in RN internals that have no browser build.
		config.resolve.extensions = [
			".web.tsx",
			".web.ts",
			".web.jsx",
			".web.js",
			...(config.resolve.extensions || []),
		];
		return config;
	},
	// Native node modules must never enter the webpack bundle — they ship a
	// prebuilt `.node` binary webpack cannot parse. The App Router /v1 routes are
	// server-only and reach these transitively through @hanzo/platform (e.g.
	// setup/server-audit → ssh2), so mark them external and let them load at
	// runtime via require().
	serverExternalPackages: [
		"ssh2",
		"node-pty",
		"bcrypt",
		"cpu-features",
		"better-sqlite3",
	],
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
			const target =
				process.env.PLATFORM_API_URL || "https://platform.hanzo.ai";
			return [
				{ source: "/v1/:path*", destination: `${target}/v1/:path*` },
				{ source: "/apps", destination: "/dashboard/apps" },
				{ source: "/templates", destination: "/dashboard/templates" },
			];
		}

		return [
			{ source: "/apps", destination: "/dashboard/apps" },
			{ source: "/templates", destination: "/dashboard/templates" },
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
