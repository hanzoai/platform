import dotenv, { type DotenvParseOutput } from "dotenv";
import esbuild from "esbuild";

const result = dotenv.config({ path: ".env.production" });

// The ONLY keys inlined as compile-time literals. Everything else in
// .env.production stays a runtime lookup, served by the .env the image copies
// and overridable by the deployment.
//
// This list is an allowlist because the rule used to be inverted: every key was
// inlined and DATABASE_URL carried a hand-written exception so it could still be
// overridden at runtime. One key was exempted because it was the one that bit
// someone; the same freeze applied silently to every other key, so PORT could
// not be changed at deploy time, and any secret added to this file would have
// been compiled into the shipped bundle as a string literal.
//
// A value belongs here only if the BUILD must see it — NODE_ENV selects code
// paths and drives dead-code elimination, so it does. Configuration does not:
// where the app listens and what it connects to are properties of a deployment,
// not of an artifact, and the same artifact has to run in every environment.
const BUILD_TIME_KEYS = ["NODE_ENV"] as const;

function prepareDefine(config: DotenvParseOutput | undefined) {
	const define: Record<string, string> = {};
	if (!config) {
		return define;
	}
	for (const key of BUILD_TIME_KEYS) {
		const value = config[key];
		if (value !== undefined) {
			define[`process.env.${key}`] = JSON.stringify(value);
		}
	}
	return define;
}

const define = prepareDefine(result.parsed);

// Banner to create `require` in ESM context for CJS dependencies
const banner = {
	js: `import { createRequire } from 'module';const require = createRequire(import.meta.url);`,
};

try {
	esbuild
		.build({
			entryPoints: {
				server: "server/server.ts",
				migration: "migration.ts",
				"reset-password": "reset-password.ts",
				"reset-2fa": "reset-2fa.ts",
				"migrate-auth-secret": "scripts/migrate-auth-secret.ts",
			},
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node18",
			outExtension: { ".js": ".mjs" },
			minify: true,
			sourcemap: true,
			outdir: "dist",
			tsconfig: "tsconfig.server.json",
			define,
			packages: "external",
			banner,
		})
		.catch(() => {
			return process.exit(1);
		});
} catch (error) {
	console.log(error);
}
