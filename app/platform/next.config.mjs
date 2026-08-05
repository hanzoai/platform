/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */

import { createRequire } from "node:module";

// dist/root.js imports the sheet RELATIVELY (`./styles.css`), so the webpack
// alias below has to name the absolute file, not the bare specifier.
const require = createRequire(import.meta.url);
const hanzoUiStylesCss = require.resolve("@hanzo/ui/styles.css");

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
		// Pages-router SERVER builds externalize CJS deps; these two ship CJS
		// that `require("react-native")` — the Flow-typed native entry Node
		// cannot parse. Transpiling forces them through webpack, where the
		// react-native -> react-native-web alias applies. hanzo.ai (App Router)
		// does not need this because app-router server builds bundle deps.
		"react-native-svg",
		"@hanzogui/lucide-icons-2",
	],
	webpack: (config) => {
		config.resolve.alias = {
			...config.resolve.alias,
			"react-native$": "react-native-web",
			// @hanzo/ui ≥8.0.45 imports its shipped design-token sheet from root.js.
			// That sheet and this app define the SAME custom-property names in
			// incompatible dialects: the sheet says `--background:#0a0a0a` (full
			// values, consumed as var(--background)); this app's globals.css says
			// `--background: 0 0% 0%` (bare HSL triples, consumed as
			// hsl(var(--background)) by every Tailwind-styled file). Whichever
			// loads last silently breaks the other side's colors — and the sheet's
			// native `@layer base` also errors in Tailwind v3's PostCSS. Until the
			// utility-class migration replaces the app's token dialect, the app
			// stays the ONE token source and the sheet stays out of the document —
			// exactly the CSS delivery 8.0.44 had (its dist never imported the
			// sheet), which is the visually-verified state. Components are
			// unaffected: they style through @hanzo/gui props, not sheet classes.
			[hanzoUiStylesCss]: false,
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
