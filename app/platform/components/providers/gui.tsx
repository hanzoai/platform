/**
 * The @hanzo/ui root.
 *
 * `<Hanzo>` is the whole mount: it supplies the @hanzo/gui config every
 * primitive resolves its tokens through (`$background`, `$color12`, the `$N`
 * ladder), and it imports the compiled stylesheet carrying the atomic rules
 * those components were published with. There is no config file to keep in step
 * and no generator to run — a private copy of either would be a second scale
 * that drifts from the components using it.
 *
 * `theme` is fixed to dark because that is the only palette this app HAS.
 * `styles/globals.css` declares `:root` and `.dark` as the same dark ramp (they
 * differ in seven incidental values — border, ring, muted), so the mode toggle
 * has never lightened the platform and next-themes' `light` class has never
 * meant anything here.
 *
 * Passing `resolvedTheme` through anyway is what broke: it puts gui's `t_light`
 * on <html>, and @hanzo/ui's stylesheet hangs its OWN token names off that
 * class — including `--text-primary`, which its base layer paints every bare
 * `h1`–`h4` with. On this app's permanently dark background that rendered every
 * heading as dark text on black. Measured on the light screenshot.
 *
 * So gui is told the truth about which palette is on screen. When the platform
 * grows a real light theme, this reads `resolvedTheme` again — and by then
 * there will be something for it to resolve to.
 */
"use client";

import { Hanzo } from "@hanzo/ui";
import type { ReactNode } from "react";

export const GuiProvider = ({ children }: { children: ReactNode }) => (
	<Hanzo theme="dark">{children}</Hanzo>
);
