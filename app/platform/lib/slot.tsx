/**
 * Slot — render the parent's props onto its single child element.
 *
 * This is the whole of what `asChild` needs here: sidebar and breadcrumb
 * wrappers put their classes and handlers on whatever element the caller
 * passes (a Link, a button). Child props win on conflicts, classNames and
 * styles merge, refs compose — the same contract the radix Slot had for
 * these call sites, small enough to own outright.
 */
import * as React from "react";

type AnyProps = Record<string, unknown>;

const mergeProps = (slotProps: AnyProps, childProps: AnyProps): AnyProps => {
	const merged: AnyProps = { ...slotProps, ...childProps };
	for (const key of Object.keys(slotProps)) {
		const a = slotProps[key];
		const b = childProps[key];
		if (/^on[A-Z]/.test(key) && typeof a === "function") {
			merged[key] =
				typeof b === "function"
					? (...args: unknown[]) => {
							(b as (...a: unknown[]) => void)(...args);
							(a as (...a: unknown[]) => void)(...args);
						}
					: a;
		} else if (key === "className") {
			merged.className = [a, b].filter(Boolean).join(" ");
		} else if (key === "style") {
			merged.style = { ...(a as object), ...(b as object) };
		}
	}
	return merged;
};

export const Slot = React.forwardRef<HTMLElement, AnyProps>(
	({ children, ...slotProps }, ref) => {
		if (!React.isValidElement(children)) return null;
		const childRef = (children as { ref?: React.Ref<unknown> }).ref;
		return React.cloneElement(children, {
			...mergeProps(slotProps, children.props as AnyProps),
			ref: ref
				? (node: HTMLElement) => {
						if (typeof ref === "function") ref(node);
						else if (ref) ref.current = node;
						if (typeof childRef === "function") childRef(node);
						else if (childRef)
							(childRef as React.MutableRefObject<unknown>).current = node;
					}
				: childRef,
		} as AnyProps);
	},
);
Slot.displayName = "Slot";
