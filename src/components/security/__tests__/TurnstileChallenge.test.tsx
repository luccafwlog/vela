// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TURNSTILE_MESSAGES } from '../../../lib/turnstileMessages'
import { TurnstileChallenge } from '../TurnstileChallenge'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  delete window.turnstile
  document.getElementById('cloudflare-turnstile-api')?.remove()
})

it('renderiza o widget explícito e entrega o token efêmero ao formulário', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'public-site-key')
  const onToken = vi.fn()
  const onError = vi.fn()
  const remove = vi.fn()
  window.turnstile = {
    render: (_container, options) => {
      expect(options.sitekey).toBe('public-site-key')
      expect(options.action).toBe('portal_login')
      options.callback('one-time-token')
      return 'widget-1'
    },
    remove,
  }

  const { container } = render(<TurnstileChallenge action="portal_login" onToken={onToken} onError={onError} />)

  await waitFor(() => expect(onToken).toHaveBeenCalledWith('one-time-token'))
  expect(onError).toHaveBeenLastCalledWith('')
  expect(container.querySelector('[role="group"][aria-label="Verificação de segurança"]')).toBeTruthy()
  cleanup()
  expect(remove).toHaveBeenCalledWith('widget-1')
})

it('falha fechado quando a chave pública não está configurada', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  const onToken = vi.fn()
  const onError = vi.fn()

  render(<TurnstileChallenge action="portal_login" onToken={onToken} onError={onError} />)

  await waitFor(() => expect(onError).toHaveBeenCalledWith(TURNSTILE_MESSAGES.unconfigured))
  expect(onToken).toHaveBeenCalledWith('')
  expect(window.turnstile).toBeUndefined()
})
