import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packagePath = path.resolve(__dirname, "../package.json");
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

pkg.main = "./dist/index.js";

pkg.exports = {
	".": {
		import: "./dist/index.js",
		require: "./dist/index.cjs.js",
	},
	"./package.json": "./package.json",
	"./constants": "./dist/constants/index.js",
	"./db": "./dist/db/index.js",
	"./db/schema": "./dist/db/schema/index.js",
	"./db/schema/*": "./dist/db/schema/*.js",
	"./lib/auth": "./dist/lib/auth.js",
	"./services/ci": "./dist/services/ci/index.js",
	"./services/*": "./dist/services/*.js",
	// Directory entry points need an explicit entry: the "./templates/*" and
	// "./utils/*" patterns resolve to "./dist/templates.js" /
	// "./dist/utils/builders.js", which esbuild never emits — it preserves the
	// source tree, so the real files are "<dir>/index.js".
	"./templates": "./dist/templates/index.js",
	"./templates/*": "./dist/templates/*.js",
	"./utils/builders": "./dist/utils/builders/index.js",
	"./utils/*": "./dist/utils/*.js",
	"./utils/ai/*": "./dist/utils/ai/*.js",
	"./utils/backups/*": "./dist/utils/backups/*.js",
	"./utils/process/*": "./dist/utils/process/*.js",
	"./utils/restore": "./dist/utils/restore/index.js",
	"./*": "./dist/*.js",
};

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
console.log("Switched exports to use dist for production");
