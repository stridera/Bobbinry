import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { createPortal } from 'react-dom'

const PanelActionsContext = createContext<HTMLElement | null>(null)

export const PanelActionsProvider = PanelActionsContext.Provider

export function PanelActions({ children }: { children: ReactNode }) {
  const target = useContext(PanelActionsContext)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || !target) return null
  return createPortal(children, target)
}
