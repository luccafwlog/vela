import { useSearchParams } from 'react-router-dom'

/**
 * "Mostrar inativas" das Tarifas de Demurrage (decisão de 2026-10-16):
 * desligado por padrão, guardado em `?inativas=1`, vale nas duas abas.
 */
export function useShowInactive(): [boolean, (next: boolean) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const showInactive = searchParams.get('inativas') === '1'
  function setShowInactive(next: boolean) {
    setSearchParams((params) => {
      const updated = new URLSearchParams(params)
      if (next) updated.set('inativas', '1')
      else updated.delete('inativas')
      return updated
    }, { replace: true })
  }
  return [showInactive, setShowInactive]
}
