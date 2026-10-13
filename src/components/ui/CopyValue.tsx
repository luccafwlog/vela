import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'

/**
 * Identificador com o ícone de copiar ao lado (ADR 0081, decisão de
 * 2026-10-13): número do B/L, CE Mercante, CNPJ e número do contêiner. O
 * ícone aparece ao passar o mouse na linha ou no valor e ao receber o foco do
 * teclado; em tela de toque fica sempre visível. A confirmação é local (ícone
 * de visto e aviso ao leitor de tela), sem depender do ToastProvider.
 */
export function CopyValue({
  value,
  label,
  children,
}: {
  /** Texto copiado. */
  value: string | null | undefined
  /** O que é copiado, para o nome acessível: "número do B/L", "CNPJ". */
  label: string
  /** O que aparece; padrão: o próprio valor. */
  children?: ReactNode
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const text = value?.trim() ?? ''
  if (!text) return <>{children ?? null}</>

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard indisponível')
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  return (
    <span className="app-copy">
      {children ?? text}
      <button
        type="button"
        className="app-copy__button"
        aria-label={`Copiar ${label} ${text}`}
        title={`Copiar ${label}`}
        data-state={state}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copy()
        }}
      >
        {state === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? `${label} copiado` : state === 'failed' ? `Não foi possível copiar o ${label}` : ''}
      </span>
    </span>
  )
}
