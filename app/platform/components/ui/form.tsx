/**
 * Form — the react-hook-form binding layer `@hanzo/ui` 5.x exported from
 * `@hanzo/ui/form`.
 *
 * 8.x does not export it, and that is the right call: this is not a component,
 * it is form LOGIC — it wires react-hook-form's field state to the ids and
 * `aria-*` relationships that make a label, a description and an error message
 * refer to the same control. A presentational, host-agnostic library has no
 * business owning it. It belongs to the app, so here it is.
 *
 * The API is unchanged, so the ~100 call sites are untouched.
 */
import type {
	ComponentPropsWithoutRef,
	ElementRef,
	HTMLAttributes,
	ReactElement,
} from "react";
import {
	cloneElement,
	createContext,
	forwardRef,
	isValidElement,
	useContext,
	useId,
} from "react";
import {
	Controller,
	type ControllerProps,
	type FieldPath,
	type FieldValues,
	FormProvider,
	useFormContext,
	useFormState,
} from "react-hook-form";

import { Label } from "@/components/ui/label";

import "./form.css";

const join = (...parts: (string | undefined)[]) =>
	parts.filter(Boolean).join(" ");

const Form = FormProvider;

type FormFieldContextValue = { name: string };
const FormFieldContext = createContext<FormFieldContextValue | null>(null);

type FormItemContextValue = { id: string };
const FormItemContext = createContext<FormItemContextValue | null>(null);

const FormField = <
	TFieldValues extends FieldValues = FieldValues,
	TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
	...props
}: ControllerProps<TFieldValues, TName>) => (
	<FormFieldContext.Provider value={{ name: props.name }}>
		<Controller {...props} />
	</FormFieldContext.Provider>
);

const useFormField = () => {
	const fieldContext = useContext(FormFieldContext);
	const itemContext = useContext(FormItemContext);
	const { getFieldState } = useFormContext();
	const formState = useFormState({ name: fieldContext?.name as string });

	if (!fieldContext) {
		throw new Error("useFormField must be used within a <FormField>");
	}

	const fieldState = getFieldState(fieldContext.name, formState);
	const id = itemContext?.id ?? "";

	return {
		id,
		name: fieldContext.name,
		formItemId: `${id}-form-item`,
		formDescriptionId: `${id}-form-item-description`,
		formMessageId: `${id}-form-item-message`,
		...fieldState,
	};
};

const FormItem = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
	({ className, ...props }, ref) => {
		const id = useId();
		return (
			<FormItemContext.Provider value={{ id }}>
				<div
					ref={ref}
					className={join("hz-form-item", className)}
					{...props}
				/>
			</FormItemContext.Provider>
		);
	},
);
FormItem.displayName = "FormItem";

// Ref and props both belong to whatever `Label` renders, which is a @hanzo/gui
// text element rather than an <label> — the HTMLLabelElement types described
// the DOM node 5.x happened to emit, not the component this forwards to.
const FormLabel = forwardRef<
	ElementRef<typeof Label>,
	ComponentPropsWithoutRef<typeof Label>
>(({ className, ...props }, ref) => {
	const { error, formItemId } = useFormField();
	return (
		<Label
			ref={ref}
			data-invalid={error ? "true" : undefined}
			className={join("hz-form-label", className)}
			htmlFor={formItemId}
			{...props}
		/>
	);
});
FormLabel.displayName = "FormLabel";

/**
 * FormControl — hands the field's id and `aria-*` wiring to whatever control the
 * caller nested inside it.
 *
 * `cloneElement` rather than a slot component: the only props being merged are
 * ids and aria attributes, there is no class name or event handler to compose,
 * so a slot's machinery would buy nothing. The child's own props win, which is
 * the same precedence a slot applies — a control that sets its own `id` keeps it.
 */
const FormControl = forwardRef<HTMLElement, HTMLAttributes<HTMLElement>>(
	({ children, ...props }, ref) => {
		const { error, formItemId, formDescriptionId, formMessageId } =
			useFormField();

		if (!isValidElement(children)) return <>{children}</>;

		const child = children as ReactElement<Record<string, unknown>>;

		return cloneElement(child, {
			ref,
			id: formItemId,
			"aria-describedby": error
				? `${formDescriptionId} ${formMessageId}`
				: formDescriptionId,
			"aria-invalid": error ? true : undefined,
			...props,
			...child.props,
		});
	},
);
FormControl.displayName = "FormControl";

const FormDescription = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => {
	const { formDescriptionId } = useFormField();
	return (
		<p
			ref={ref}
			id={formDescriptionId}
			className={join("hz-form-description", className)}
			{...props}
		/>
	);
});
FormDescription.displayName = "FormDescription";

const FormMessage = forwardRef<
	HTMLParagraphElement,
	HTMLAttributes<HTMLParagraphElement>
>(({ className, children, ...props }, ref) => {
	const { error, formMessageId } = useFormField();
	const body = error ? String(error?.message ?? "") : children;

	if (!body) return null;

	return (
		<p
			ref={ref}
			id={formMessageId}
			className={join("hz-form-message", className)}
			{...props}
		>
			{body}
		</p>
	);
});
FormMessage.displayName = "FormMessage";

export {
	useFormField,
	Form,
	FormItem,
	FormLabel,
	FormControl,
	FormDescription,
	FormMessage,
	FormField,
};
