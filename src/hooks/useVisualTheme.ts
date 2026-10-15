import { createContext, createElement, useEffect, useMemo, useState } from 'react'

// O tema escuro saiu em 2026-10-15 (decisão do responsável): não tinha seletor
// na tela. Preferência 'dark' guardada no navegador volta ao tema atual.
export type VisualTheme = 'current' | 'light'

const storageKey = 'vela_visual_theme'
const legacyStorageKey = 'transhipping_visual_theme'

type VisualThemeContextValue = {
  theme: VisualTheme
  setTheme: (theme: VisualTheme) => void
}

const VisualThemeContext = createContext<VisualThemeContextValue | null>(null)

function isVisualTheme(value: string | null): value is VisualTheme {
  return value === 'current' || value === 'light'
}

export function VisualThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<VisualTheme>(() => {
    if (typeof window === 'undefined') return 'current'
    const stored = window.localStorage.getItem(storageKey) ?? window.localStorage.getItem(legacyStorageKey)
    return isVisualTheme(stored) ? stored : 'current'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-visual-theme', theme)
    window.localStorage.setItem(storageKey, theme)
  }, [theme])

  const value = useMemo(
    () => ({
      theme,
      setTheme,
    }),
    [theme],
  )

  return createElement(VisualThemeContext.Provider, { value }, children)
}
