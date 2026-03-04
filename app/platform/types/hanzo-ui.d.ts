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
