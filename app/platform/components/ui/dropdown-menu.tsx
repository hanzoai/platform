/**
 * DropdownMenu — @hanzo/ui 8.x on @hanzo/gui. Full compound surface, same
 * names the radix version exported.
 *
 * Radix-era props bridged in ONE place so call sites stay untouched:
 * `modal` on the root (gui menus are never modal) and popper hints
 * (`side/align/sideOffset/alignOffset`) on Content are dropped; placement
 * falls back to gui's default.
 */

import {
	DropdownMenu as UiDropdownMenu,
	DropdownMenuContent as UiDropdownMenuContent,
} from "@hanzo/ui";
import type { ComponentProps } from "react";

export {
	DropdownMenuCheckboxItem,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@hanzo/ui";

export const DropdownMenu = ({
	modal: _modal,
	...props
}: ComponentProps<typeof UiDropdownMenu> & { modal?: boolean }) => (
	<UiDropdownMenu {...props} />
);

export const DropdownMenuContent = ({
	side: _side,
	align: _align,
	sideOffset: _sideOffset,
	alignOffset: _alignOffset,
	...props
}: ComponentProps<typeof UiDropdownMenuContent> & {
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	sideOffset?: number;
	alignOffset?: number;
}) => <UiDropdownMenuContent {...props} />;
