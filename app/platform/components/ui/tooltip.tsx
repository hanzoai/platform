/**
 * Tooltip — @hanzo/ui 8.x on @hanzo/gui, with this app's radix-era prop
 * surface bridged in ONE place so ~68 call sites stay untouched:
 *
 * - `TooltipProvider delayDuration` -> gui `delay` (gui requires one; the old
 *   radix default of 700ms is kept when unspecified). `skipDelayDuration` and
 *   `disableHoverableContent` have no gui counterpart and are dropped.
 * - `Tooltip delayDuration` -> gui `delay`.
 * - `TooltipTrigger type` is dropped: the radix trigger rendered a <button>,
 *   the gui trigger is a pressable stack, so the attribute has nothing to do.
 * - `TooltipContent side/align/alignOffset` are dropped: gui content is
 *   popper-positioned from the root and does not take a side. Placement falls
 *   back to gui's default.
 * - `TooltipPortal` is the identity — gui content mounts its own float.
 */

import {
	Tooltip as UiTooltip,
	TooltipContent as UiTooltipContent,
	TooltipProvider as UiTooltipProvider,
	TooltipTrigger as UiTooltipTrigger,
} from "@hanzo/ui";
import type { ComponentProps, ReactNode } from "react";

type UiProviderProps = ComponentProps<typeof UiTooltipProvider>;

export const TooltipProvider = ({
	delayDuration,
	skipDelayDuration: _skip,
	disableHoverableContent: _hoverable,
	delay,
	...props
}: Omit<UiProviderProps, "delay"> & {
	delay?: UiProviderProps["delay"];
	delayDuration?: number;
	skipDelayDuration?: number;
	disableHoverableContent?: boolean;
}) => <UiTooltipProvider delay={delay ?? delayDuration ?? 700} {...props} />;

export const Tooltip = ({
	delayDuration,
	...props
}: ComponentProps<typeof UiTooltip> & { delayDuration?: number }) => (
	<UiTooltip
		{...(delayDuration !== undefined ? { delay: delayDuration } : {})}
		{...props}
	/>
);

export const TooltipTrigger = ({
	type: _type,
	...props
}: ComponentProps<typeof UiTooltipTrigger> & { type?: string }) => (
	<UiTooltipTrigger {...props} />
);

export const TooltipContent = ({
	side: _side,
	align: _align,
	alignOffset: _alignOffset,
	...props
}: ComponentProps<typeof UiTooltipContent> & {
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	alignOffset?: number;
}) => <UiTooltipContent {...props} />;

export const TooltipPortal = ({ children }: { children?: ReactNode }) => (
	<>{children}</>
);
