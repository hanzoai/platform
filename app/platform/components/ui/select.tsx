/**
 * Select — @hanzo/ui 8.x on @hanzo/gui. Same compound API as the radix
 * version; SelectContent stamps the item indices gui needs, so call sites
 * keep writing plain <SelectItem value="…">.
 *
 * `SelectContent side/align/position` are radix popper hints gui does not
 * take — dropped here so call sites stay untouched; placement falls back to
 * gui's default.
 */

import { SelectContent as UiSelectContent } from "@hanzo/ui";
import type { ComponentProps } from "react";

export {
	Select,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectScrollDownButton,
	SelectScrollUpButton,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@hanzo/ui";

export const SelectContent = ({
	side: _side,
	align: _align,
	position: _position,
	...props
}: ComponentProps<typeof UiSelectContent> & {
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	position?: "item-aligned" | "popper";
}) => <UiSelectContent {...props} />;
