'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { MessageBuilder, messageRouter } from '@/lib/message-router'

type Theme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light')

  // Initialize theme from localStorage and system preference
  useEffect(() => {
    const stored = localStorage.getItem('bobbinry-theme') as Theme | null
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    const initialTheme = stored || systemTheme
    setThemeState(initialTheme)
    applyTheme(initialTheme)
  }, [])

  // Apply theme to document
  const applyTheme = (newTheme: Theme) => {
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    localStorage.setItem('bobbinry-theme', newTheme)
    applyTheme(newTheme)

    // Broadcast theme change using new message system
    const themeMessage = MessageBuilder.shellThemeUpdate(newTheme)
    window.postMessage(themeMessage, '*')
  }

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
