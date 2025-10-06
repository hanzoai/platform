import * as React from "react"

// Simple toast hook implementation
export interface Toast {
  id: string
  title?: string
  description?: string
  variant?: "default" | "destructive"
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (toast: Omit<Toast, "id">) => void
  dismiss: (toastId?: string) => void
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined)

export function useToast() {
  const context = React.useContext(ToastContext)
  if (!context) {
    // Return a no-op implementation when not in provider
    return {
      toast: () => {},
      dismiss: () => {},
      toasts: []
    }
  }
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const toast = React.useCallback((t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substr(2, 9)
    setToasts((prev) => [...prev, { ...t, id }])

    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, 5000)
  }, [])

  const dismiss = React.useCallback((toastId?: string) => {
    setToasts((prev) =>
      toastId ? prev.filter((t) => t.id !== toastId) : []
    )
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}