import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["__test__/**/*.test.ts"], // Incluir solo los archivos de test en el directorio __test__
		// *.realdb.test.ts run under vitest.realdb.config.ts (no db mock — real
		// on-disk SQLite); keep them out of the mocked unit run.
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"**/.docker/**",
			"**/*.realdb.test.ts",
		],
		pool: "forks",
		setupFiles: [path.resolve(__dirname, "setup.ts")],
	},
	define: {
		"process.env": {
			NODE: "test",
			GITHUB_CLIENT_ID: "test",
			GITHUB_CLIENT_SECRET: "test",
			GOOGLE_CLIENT_ID: "test",
			GOOGLE_CLIENT_SECRET: "test",
		},
	},
	plugins: [
		tsconfigPaths({
			projects: [path.resolve(__dirname, "../tsconfig.json")],
		}),
	],
	resolve: {
		alias: {
			"@hanzo/platform": path.resolve(__dirname, "../../../pkg/platform/src"),
		},
	},
});
