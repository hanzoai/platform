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
	"./db": {
		import: "./dist/db/index.js",
		require: "./dist/db/index.cjs.js",
	},
	"./db/schema": {
		import: "./dist/db/schema/index.js",
		require: "./dist/db/schema/index.cjs.js",
	},
	"./db/schema/*": {
		import: "./dist/db/schema/*",
	},
	"./services/*": {
		import: "./dist/services/*",
	},
	"./lib/*": {
		import: "./dist/lib/*",
	},
	"./setup/*": {
		import: "./dist/setup/*",
	},
	"./constants": {
		import: "./dist/constants/index.js",
		require: "./dist/constants/index.cjs.js",
	},
	"./templates": {
		import: "./dist/templates/index.js",
	},
	"./templates/*": {
		import: "./dist/templates/*",
	},
	"./utils/*": {
		import: "./dist/utils/*",
	},
	"./types/*": {
		import: "./dist/types/*",
	},
	"./wss/*": {
		import: "./dist/wss/*",
	},
	"./*": {
		import: "./dist/*",
		require: "./dist/*.cjs",
	},
};

fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
console.log("Switched exports to use dist for production");
