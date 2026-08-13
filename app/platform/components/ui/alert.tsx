/**
 * Alert — the callout `@hanzo/ui` 5.x exported from `@hanzo/ui/alert`.
 *
 * 8.x has no `Alert`, so this is the component's home now. Same three-part API
 * the call sites already use (`Alert` + `AlertTitle` + `AlertDescription`, and
 * `variant="destructive"`), so nothing downstream changes.
 *
 * `variant` rides a `data-variant` attribute rather than a class name: the styling
 * lives in `alert.css`, which needs a selector to hang the destructive palette
 * and the icon colour on, and a data attribute IS that selector without pulling
 * in a class-name composer.
 */
import type { HTMLAttributes } from "react";
import { forwardRef } from "react";

import "./alert.css";

const join = (...parts: (string | undefined)[]) =>
	parts.filter(Boolean).join(" ");

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
	variant?: "default" | "destructive";
};

const Alert = forwardRef<HTMLDivElement, AlertProps>(
	({ className, variant = "default", ...props }, ref) => (
		<div
			ref={ref}
			role="alert"
			data-variant={variant}
			className={join("hz-alert", className)}
			{...props}
		/>
	),
);
Alert.displayName = "Alert";

const AlertTitle = forwardRef<
	HTMLHeadingElement,
	HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
	<h5 ref={ref} className={join("hz-alert-title", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef<
	HTMLDivElement,
	HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={join("hz-alert-description", className)}
		{...props}
	/>
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
