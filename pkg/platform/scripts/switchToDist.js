/**
 * `switch:prod` — point package.json at the built `dist/` tree.
 *
 * The map itself lives in ./exports-map.js; this script only applies it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportsFor, mainFor } from "./exports-map.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.resolve(__dirname, "../package.json");

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf-8"));
pkg.main = mainFor("dist");
pkg.exports = exportsFor("dist");

fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log("Switched exports to use dist for production");
