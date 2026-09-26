import { useEffect, useRef, useState } from 'react'

/** Largura em que o menu horizontal vira o botão Menu (index.css, `max-width: 1100px`). */
export const NAV_COLLAPSE_WIDTH = 1100

/**
 * Estado do menu móvel compartilhado pelo Vela e pelo Portal. Aberto, o menu
 * cobre a tela: a página por baixo não rola junto, e Escape fecha devolvendo
 * o foco ao botão Menu do cabeçalho.
 *
 * Um grupo aberto dentro do menu (Importação, Financeiro...) trata o próprio
 * Escape e interrompe a propagação: o primeiro Escape fecha o grupo, o
 * segundo fecha o menu.
 */
export function useMobileNav() {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  // Acima da largura de celular não há menu para fechar: girar o tablet com o
  // menu aberto deixaria a página travada, sem rolagem e sem botão Menu.
  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${NAV_COLLAPSE_WIDTH}px)`)
    const handleChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setOpen(false)
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      toggleRef.current?.focus()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  return { open, setOpen, toggleRef }
}
