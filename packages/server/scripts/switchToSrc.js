import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const packagePath = path.resolve(__dirname, "../package.json");

// Leer el archivo package.json
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));

pkg.main = "./src/index.ts";

// Modificar los exports
pkg.exports = {
	".": "./src/index.ts",
	"./db": {
		import: "./src/db/index.ts",
		require: "./dist/db/index.cjs.js",
	},
	"./db/schema": {
		import: "./src/db/schema/index.ts",
	},
	"./db/schema/*": {
		import: "./src/db/schema/*.ts",
	},
	"./services/*": {
		import: "./src/services/*.ts",
	},
	"./lib/*": {
		import: "./src/lib/*.ts",
	},
	"./setup/*": {
		import: "./src/setup/*.ts",
		require: "./dist/setup/index.cjs.js",
	},
	"./constants": {
		import: "./src/constants/index.ts",
		require: "./dist/constants.cjs.js",
	},
	"./templates": {
		import: "./src/templates/index.ts",
	},
	"./templates/*": {
		import: "./src/templates/*.ts",
	},
};

// Guardar los cambios en package.json
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
console.log("Switched exports to use src for development");
