import { useEffect, useRef } from 'react'
import { TURNSTILE_MESSAGES } from '../../lib/turnstileMessages'

type TurnstileRenderOptions = {
  sitekey: string
  action: string
  theme: 'auto'
  callback: (token: string) => void
  'expired-callback': () => void
  'error-callback': () => void
}

type TurnstileApi = {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

type TurnstileChallengeProps = {
  action: string
  resetKey?: number
  onToken: (token: string) => void
  onError: (message: string) => void
}

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-api'

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()

  return new Promise((resolve, reject) => {
    let script = document.getElementById(TURNSTILE_SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = TURNSTILE_SCRIPT_ID
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.append(script)
    }

    script.addEventListener('load', () => resolve(), { once: true })
    script.addEventListener('error', () => reject(new Error('Turnstile script unavailable')), { once: true })
  })
}

export function TurnstileChallenge({ action, resetKey = 0, onToken, onError }: TurnstileChallengeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  const onErrorRef = useRef(onError)

  useEffect(() => { onTokenRef.current = onToken }, [onToken])
  useEffect(() => { onErrorRef.current = onError }, [onError])

  useEffect(() => {
    let cancelled = false
    let widgetId: string | null = null
    const siteKey = String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? '').trim()
    onTokenRef.current('')

    if (!siteKey) {
      // Quando o Turnstile ainda não foi configurado no ambiente, não bloqueia o fluxo.
      return
    }

    onErrorRef.current('')
    void loadTurnstileScript().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: 'auto',
        callback: (token) => {
          onTokenRef.current(token)
          onErrorRef.current('')
        },
        'expired-callback': () => onTokenRef.current(''),
        'error-callback': () => {
          onTokenRef.current('')
          onErrorRef.current(TURNSTILE_MESSAGES.verification)
        },
      })
    }).catch(() => {
      if (!cancelled) onErrorRef.current(TURNSTILE_MESSAGES.verification)
    })

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [action, resetKey])

  return <div ref={containerRef} role="group" aria-label="Verificação de segurança" />
}
