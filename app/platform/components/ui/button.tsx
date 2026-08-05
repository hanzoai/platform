/**
 * Button — @hanzo/ui 8.x on @hanzo/gui. Superset of the shadcn contract
 * (variant/size/asChild/isLoading); radix Slot and cva are gone.
 *
 * `form` is added to the type: it is a real DOM attribute this app uses to
 * submit dialogs whose <form> lives elsewhere in the tree, and gui's Frame
 * forwards unrecognised props to the rendered <button> on web (the same
 * passthrough @hanzo/ui documents for `title`).
 */

import {
	Button as UiButton,
	type ButtonProps as UiButtonProps,
} from "@hanzo/ui";
import { forwardRef } from "react";

export { buttonVariants } from "@hanzo/ui";

export type ButtonProps = UiButtonProps & { form?: string };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	(props, ref) => <UiButton ref={ref as never} {...props} />,
);
Button.displayName = "Button";
