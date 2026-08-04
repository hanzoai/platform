/**
 * The @hanzo/gui runtime, mounted once.
 *
 * `@hanzo/ui` 8 renders every primitive through `@hanzo/gui`, and gui resolves
 * its token namespace (`$background`, `$color12`, `$borderColor`, the `$N` type
 * ladder) from a config supplied by this provider. Without it a gui component
 * mounts with no theme and draws transparent — it does not throw, which is
 * exactly why the provider has to be unconditional and at the root.
 *
 * The config is `@hanzo/ui/gui-config` — the scale ships WITH the components, so
 * every Hanzo surface renders @hanzo/ui at the same sizes, radii and spacing. A
 * private copy here would be a second scale that drifts.
 *
 * gui writes its OWN theme class (`t_dark`/`t_light`) onto <html>, and it has to
 * — that class is what every `$color12`/`$background` reference resolves
 * through. It does not fight next-themes: both use `classList`, so `dark` and
 * `t_dark` sit side by side on the element. `disableRootThemeClass` suppresses
 * gui's half, and does it silently: `defaultTheme` still reads as accepted while
 * nothing it says can reach the root. Measured on the production build, with the
 * flag gone: a dark-preferring client gets `class="font-sans t_dark dark"` and
 * `--background: hsla(0,0%,8%,1)`, a light one `t_light light` and
 * `hsla(0,0%,97%,1)`. With the flag set there is no `t_*` class at all, so both
 * resolve the same way and the toggle does nothing.
 *
 * So next-themes stays the source of truth for WHICH theme, and gui applies it.
 *
 * `disableInjectCSS` is paired with `styles/gui.css`, which
 * `scripts/gen-gui-css.mjs` writes from this same config. Injected at runtime,
 * that sheet is the one node whose TEXT differs between server and client — it
 * accumulates as components construct — so React 18 threw #425 and fell back to
 * client-rendering the entire root (#423) on every page. Measured on the
 * production build. Per-component atomic rules are untouched: they ride React's
 * own `<style href precedence>` hoisting, which reconciles by href.
 */
"use client";

import { GuiProvider as Gui } from "@hanzo/gui";
import guiConfig from "@hanzo/ui/gui-config";
import { useTheme } from "next-themes";
import type { ReactNode } from "react";

export const GuiProvider = ({ children }: { children: ReactNode }) => {
	const { resolvedTheme } = useTheme();

	return (
		<Gui
			config={guiConfig}
			defaultTheme={resolvedTheme === "light" ? "light" : "dark"}
			disableInjectCSS
		>
			{children}
		</Gui>
	);
};
