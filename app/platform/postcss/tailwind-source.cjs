/**
 * Tailwind, restricted to this app's own stylesheets.
 *
 * A dependency ships CSS that is already compiled — `@hanzo/ui/dist/styles.css`
 * is emitted at @hanzo/ui's publish time, with its base rules wrapped in
 * `@layer base` so an app's own reset outranks them. Tailwind refuses any file
 * that uses `@layer` without also declaring `@tailwind base`, which a finished
 * stylesheet never does, so running it over `node_modules` fails the build to
 * no purpose: there are no utility classes in there for it to generate.
 *
 * Same plugin, same config, same order — the only change is which files it
 * looks at. Written as a file because Next resolves postcss plugins by name and
 * will not take an instance.
 */
const tailwindcss = require("tailwindcss");

const { postcssPlugin, plugins } = tailwindcss();

module.exports = {
	postcssPlugin,
	plugins: plugins.map((run) => (root, result) => {
		const file = root.source?.input?.file ?? "";
		if (file.includes("node_modules")) return undefined;
		return run(root, result);
	}),
};
