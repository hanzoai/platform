/**
 * Toggle — a pressed/unpressed button. The radix primitive did exactly this:
 * `aria-pressed` + `data-state` on a real <button>, controlled through
 * `pressed`/`onPressedChange`. That is small enough to own, so it lives here
 * and the radix + cva deps are gone.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

type ToggleProps = Omit<
	React.ButtonHTMLAttributes<HTMLButtonElement>,
	"onChange"
> & {
	pressed?: boolean;
	defaultPressed?: boolean;
	onPressedChange?: (pressed: boolean) => void;
	variant?: "default" | "outline";
	size?: "default" | "sm" | "lg";
};

const sizes = { default: "h-10 px-3", sm: "h-9 px-2.5", lg: "h-11 px-5" };

const Toggle = React.forwardRef<HTMLButtonElement, ToggleProps>(
	(
		{
			className,
			pressed,
			defaultPressed = false,
			onPressedChange,
			onClick,
			variant = "default",
			size = "default",
			...props
		},
		ref,
	) => {
		const [own, setOwn] = React.useState(defaultPressed);
		const isPressed = pressed ?? own;
		return (
			<button
				ref={ref}
				type="button"
				aria-pressed={isPressed}
				data-state={isPressed ? "on" : "off"}
				className={cn(
					"inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
					variant === "outline" &&
						"border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
					sizes[size],
					className,
				)}
				onClick={(e) => {
					onClick?.(e);
					if (e.defaultPrevented) return;
					if (pressed === undefined) setOwn(!isPressed);
					onPressedChange?.(!isPressed);
				}}
				{...props}
			/>
		);
	},
);
Toggle.displayName = "Toggle";

export { Toggle };
