/**
 * Popover — @hanzo/ui 8.x on @hanzo/gui, with the radix-era prop surface
 * bridged here so call sites stay untouched:
 *
 * - `Popover modal` is dropped — gui popovers are never modal.
 * - `PopoverTrigger type` is dropped: the radix trigger rendered a real
 *   <button> (where type="button" suppressed implicit form submits); the gui
 *   trigger is a pressable stack, so the attribute has nothing to do.
 * - `PopoverContent side` is dropped (gui positions from the popper root);
 *   `align`/`sideOffset` pass through — @hanzo/ui handles those.
 */

import {
	Popover as UiPopover,
	PopoverContent as UiPopoverContent,
	PopoverTrigger as UiPopoverTrigger,
} from "@hanzo/ui";
import type { ComponentProps } from "react";

export const Popover = ({
	modal: _modal,
	...props
}: ComponentProps<typeof UiPopover> & { modal?: boolean }) => (
	<UiPopover {...props} />
);

export const PopoverTrigger = ({
	type: _type,
	...props
}: ComponentProps<typeof UiPopoverTrigger> & { type?: string }) => (
	<UiPopoverTrigger {...props} />
);

export const PopoverContent = ({
	side: _side,
	...props
}: ComponentProps<typeof UiPopoverContent> & {
	side?: "top" | "right" | "bottom" | "left";
}) => <UiPopoverContent {...props} />;
