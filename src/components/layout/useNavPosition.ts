import { useCallback, useState } from 'react'

/**
 * Onde fica o menu do Vela no desktop, escolhido no menu da conta:
 * - `top`: barra no topo (padrão, como antes da lateral);
 * - `fixed`: lateral sempre aberta;
 * - `collapsed`: lateral só com os ícones, grupos abrem ao lado;
 * - `expandable`: lateral só com os ícones que abre por cima da página ao
 *   passar o mouse ou ao receber o foco do teclado.
 *
 * Abaixo de NAV_COLLAPSE_WIDTH toda posição usa o botão Menu do cabeçalho.
 * O Portal Fwlog não usa esta preferência.
 */
export type NavPosition = 'top' | 'fixed' | 'collapsed' | 'expandable'

export const NAV_POSITION_OPTIONS: ReadonlyArray<{ value: NavPosition; label: string; hint: string }> = [
  { value: 'top', label: 'No topo', hint: 'Barra azul no alto da tela' },
  { value: 'fixed', label: 'Lateral fixa', hint: 'Sempre aberta' },
  { value: 'collapsed', label: 'Lateral recolhida', hint: 'Só os ícones' },
  { value: 'expandable', label: 'Lateral expansível', hint: 'Abre ao passar o mouse' },
]

// ponytail: a escolha fica no navegador, como o tema visual; outro computador
// começa no topo. Guardar no perfil exigiria coluna e RPC.
export const NAV_POSITION_STORAGE_KEY = 'vela_nav_position'

export function parseNavPosition(value: string | null): NavPosition {
  return NAV_POSITION_OPTIONS.some((option) => option.value === value) ? (value as NavPosition) : 'top'
}

function readStoredNavPosition(): NavPosition {
  try {
    return parseNavPosition(window.localStorage.getItem(NAV_POSITION_STORAGE_KEY))
  } catch {
    return 'top'
  }
}

export function useNavPosition() {
  const [position, setPositionState] = useState<NavPosition>(() =>
    typeof window === 'undefined' ? 'top' : readStoredNavPosition(),
  )

  const setPosition = useCallback((next: NavPosition) => {
    setPositionState(next)
    try {
      window.localStorage.setItem(NAV_POSITION_STORAGE_KEY, next)
    } catch {
      // Navegador sem armazenamento: a escolha vale até recarregar a página.
    }
  }, [])

  return [position, setPosition] as const
}
