declare module '@hanzo/ui/navigation' {
  import type { ReactNode } from 'react'

  // ── Types ──

  export type HanzoApp = {
    id: string
    label: string
    href: string
    icon?: ReactNode
    description?: string
  }

  export type HanzoOrg = {
    id: string
    name: string
    slug: string
    role?: string
  }

  export type HanzoUser = {
    id?: string
    name?: string
    email: string
    avatar?: string
  }

  export type HanzoShellProps = {
    currentApp: string
    currentAppId?: string
    user?: HanzoUser
    organizations?: HanzoOrg[]
    currentOrgId?: string
    onOrgSwitch?: (orgId: string) => void
    onSignOut?: () => void
    apps?: HanzoApp[]
    headerRight?: ReactNode
    children?: ReactNode
  }

  export type HanzoCommandItem = {
    id: string
    title: string
    description?: string
    href?: string
    action?: () => void
    icon?: ReactNode
    category: string
    external?: boolean
    keywords?: string[]
  }

  export type HanzoCommandPaletteProps = {
    commands?: HanzoCommandItem[]
    apps?: HanzoApp[]
    currentAppId?: string
    open?: boolean
    onOpenChange?: (open: boolean) => void
    onNavigate?: (href: string, external?: boolean) => void
  }

  // ── Components ──

  export function HanzoHeader(props: Omit<HanzoShellProps, 'children'>): JSX.Element
  export function HanzoCommandPalette(props: HanzoCommandPaletteProps): JSX.Element | null
  export function useHanzoAuth(): {
    user: HanzoUser | undefined
    organizations: HanzoOrg[]
    currentOrgId: string | undefined
    token: string | null
    loading: boolean
    signOut: () => void
    switchOrg: (orgId: string) => void
  }

  export const DEFAULT_HANZO_APPS: HanzoApp[]
}

declare module '@hanzo/ui/form' {
  import type * as React from 'react'
  import type {
    ControllerProps,
    FieldError,
    FieldPath,
    FieldValues,
    FormProviderProps,
  } from 'react-hook-form'

  export const Form: <TFieldValues extends FieldValues, TContext = any>(
    props: FormProviderProps<TFieldValues, TContext>,
  ) => JSX.Element

  export const FormField: <
    TFieldValues extends FieldValues = FieldValues,
    TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
  >(
    props: ControllerProps<TFieldValues, TName>,
  ) => JSX.Element

  export function useFormField(): {
    id: string
    name: string
    formItemId: string
    formDescriptionId: string
    formMessageId: string
    error?: FieldError
    invalid: boolean
    isDirty: boolean
    isTouched: boolean
    isValidating: boolean
  }

  export const FormItem: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> & React.RefAttributes<HTMLDivElement>
  >
  export const FormLabel: React.ForwardRefExoticComponent<
    React.LabelHTMLAttributes<HTMLLabelElement> &
      React.RefAttributes<HTMLLabelElement>
  >
  export const FormControl: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>
  >
  export const FormDescription: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLParagraphElement> &
      React.RefAttributes<HTMLParagraphElement>
  >
  export const FormMessage: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLParagraphElement> &
      React.RefAttributes<HTMLParagraphElement>
  >
}

declare module '@hanzo/ui/collapsible' {
  import type * as React from 'react'

  export const Collapsible: React.FC<
    {
      open?: boolean
      defaultOpen?: boolean
      onOpenChange?: (open: boolean) => void
      disabled?: boolean
      asChild?: boolean
    } & React.HTMLAttributes<HTMLDivElement>
  >
  export const CollapsibleTrigger: React.ForwardRefExoticComponent<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      asChild?: boolean
    } & React.RefAttributes<HTMLButtonElement>
  >
  export const CollapsibleContent: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> &
      React.RefAttributes<HTMLDivElement>
  >
}

declare module '@hanzo/ui/alert' {
  import type * as React from 'react'

  export const Alert: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLDivElement> & {
      variant?: 'default' | 'destructive'
    } & React.RefAttributes<HTMLDivElement>
  >
  export const AlertTitle: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLHeadingElement> &
      React.RefAttributes<HTMLParagraphElement>
  >
  export const AlertDescription: React.ForwardRefExoticComponent<
    React.HTMLAttributes<HTMLParagraphElement> &
      React.RefAttributes<HTMLParagraphElement>
  >
}
