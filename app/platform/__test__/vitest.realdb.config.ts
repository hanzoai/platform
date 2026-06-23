import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Integration config: NO global db mock (setupFiles omitted) so the Stage 2
 * integration test runs against a REAL on-disk SQLite database. Scoped to the
 * *.integration.test.ts files only.
 */
export default defineConfig({
	test: {
		include: ["__test__/**/*.realdb.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/.docker/**"],
		pool: "forks",
		// deliberately no setupFiles — we want the real @hanzo/platform/db.
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
