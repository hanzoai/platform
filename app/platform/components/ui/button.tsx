/**
 * Button — @hanzo/ui 8.x on @hanzo/gui. Superset of the shadcn contract
 * (variant/size/asChild/isLoading); radix Slot and cva are gone.
 *
 * The gui frame renders `<div role="button">` on web (measured on the
 * register page), and native form semantics die on a div: `type="submit"`
 * and `form="id"` are inert attributes there, so every submit button in the
 * app would click into silence while the build stayed green. This wrapper
 * restores the contract in ONE place: a submit-typed Button submits its form
 * imperatively — the `form` attribute names it, otherwise the nearest
 * ancestor <form> — via requestSubmit(), which still runs the form's onSubmit
 * (react-hook-form's handleSubmit) exactly like a native submit click.
 */

import {
	Button as UiButton,
	type ButtonProps as UiButtonProps,
} from "@hanzo/ui";
import { forwardRef, type MouseEvent, type MouseEventHandler } from "react";

export { buttonVariants } from "@hanzo/ui";

export type ButtonProps = UiButtonProps & {
	form?: string;
	type?: "button" | "submit" | "reset";
	onClick?: MouseEventHandler<HTMLElement>;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ type, form, onClick, ...props }, ref) => {
		const handleClick =
			type === "submit"
				? (e: MouseEvent<HTMLElement>) => {
						onClick?.(e);
						if (e.defaultPrevented || props.disabled || props.isLoading)
							return;
						const target = form
							? document.getElementById(form)
							: (e.currentTarget as HTMLElement).closest("form");
						if (target instanceof HTMLFormElement) target.requestSubmit();
					}
				: onClick;
		// gui's prop type names no DOM attribute (type/form/onClick), but the
		// frame forwards them to the rendered element on web — hand them over
		// inside the spread, where no excess-property check applies.
		const forwarded = {
			...props,
			type,
			form,
			onClick: handleClick,
		} as UiButtonProps;
		return <UiButton ref={ref as never} {...forwarded} />;
	},
);
Button.displayName = "Button";
