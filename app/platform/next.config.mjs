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
	// @hanzo/ui 8 renders every primitive through @hanzo/gui, which ships
	// untranspiled ESM and resolves modules the React-Native way. Next has to
	// compile those packages and point `react-native` at the web implementation —
	// that pair IS the browser story for the gui substrate, and omitting either
	// one fails at bundle time, not at runtime.
	//
	// Listing a package here also stops Next externalising it from the SERVER
	// bundle, which matters as much as the transpiling: left external, Node
	// loads the package's own entry at runtime and picks the CJS condition, which
	// anywhere in the React-Native graph means the NATIVE build. That is how a
	// page that "compiled successfully" then died collecting page data on
	// `import typeof` — Flow syntax, from react-native's index.
	transpilePackages: [
		"@hanzo/platform",
		"@hanzo/ui",
		"@hanzo/gui",
		"react-native-web",
		"react-native-svg",
		// The icon set is the one package that reaches react-native-svg. Left
		// external it is loaded by Node, which picks the CJS/native condition and
		// walks straight into the graph above.
		"@hanzogui/lucide-icons-2",
		"@hanzogui/helpers-icon",
	],
	webpack: (config) => {
		config.resolve.alias = {
			...config.resolve.alias,
			"react-native$": "react-native-web",
			// Same rule, one level down. react-native-svg reaches the asset
			// registry through `@react-native/assets-registry`, which is a
			// two-function re-export of `react-native`'s copy — and the web
			// implementation of those two functions ships in react-native-web
			// already. Pointing at it resolves the import to the code that
			// actually runs in a browser rather than to a native module.
			"@react-native/assets-registry/registry$":
				"react-native-web/dist/modules/AssetRegistry",
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
