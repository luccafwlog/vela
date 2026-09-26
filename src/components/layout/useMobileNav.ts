import { useEffect, useRef, useState } from 'react'

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
