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
 * `disableRootThemeClass`: next-themes already owns the `class` attribute on
 * <html> (`attribute="class"` in _app), and gui writing its own theme class onto
 * the same element fights it. gui follows next-themes instead, via
 * `defaultTheme`.
 *
 * CSS injection is left ON. hanzo.ai turns it off because it pre-generates the
 * sheet in a `prebuild` step; this app has no such step, so the runtime sheet is
 * the only source and disabling it would render everything unstyled.
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
			disableRootThemeClass
		>
			{children}
		</Gui>
	);
};
