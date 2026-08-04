/**
 * Regenerate `styles/gui.css` — @hanzo/gui's base sheet, as a real stylesheet.
 *
 * gui builds this sheet at runtime and injects it as a `<style>` from the
 * provider. Under SSR that element is the one thing in the tree whose CONTENT
 * differs between server and client: the sheet accumulates as components are
 * constructed, so the server's copy is whatever had rendered when the response
 * flushed and the client's is whatever has rendered by hydration. React 18 sees
 * mismatched text, throws #425, and falls back to client-rendering the ENTIRE
 * root (#423) — measured on this app's production build before this file
 * existed. Every page lost its server render.
 *
 * Emitting it statically removes the mismatching node: `GuiProvider` renders
 * with `disableInjectCSS`, and this file is the one source of the base sheet.
 * Per-component atomic rules are unaffected — those ride React's own
 * `<style href precedence>` hoisting, which reconciles by href and cannot
 * mismatch.
 *
 * Run from `build-next` and `dev:frontend` rather than an npm `prebuild` hook,
 * because pnpm does not run pre/post scripts unless `enable-pre-post-scripts`
 * is on, and a config-dependent build step is not a build step.
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";

const appDir = new URL("..", import.meta.url).pathname;
const entry = new URL("../.guicfg.entry.mjs", import.meta.url);
const bundle = new URL("../.guicfg.gen.mjs", import.meta.url);

writeFileSync(entry, 'export { default } from "@hanzo/ui/gui-config";\n');

// The config pulls in the @hanzogui graph, which imports `react-native` by bare
// specifier. Bundle it first with the same alias the Next build uses — the
// native implementation has no business running in Node.
try {
	execFileSync(
		"esbuild",
		[
			entry.pathname,
			"--bundle",
			"--format=esm",
			"--platform=node",
			"--external:react",
			"--external:react-dom",
			"--external:react-native",
			"--alias:react-native=react-native-web",
			`--outfile=${bundle.pathname}`,
			"--log-level=error",
		],
		{ stdio: "inherit", cwd: appDir },
	);
} finally {
	rmSync(entry, { force: true });
}

const { default: config } = await import(bundle);
const css = config.getCSS();
writeFileSync(new URL("../styles/gui.css", import.meta.url), css);
rmSync(bundle, { force: true });
console.log(`styles/gui.css regenerated — ${css.length.toLocaleString()} bytes`);
