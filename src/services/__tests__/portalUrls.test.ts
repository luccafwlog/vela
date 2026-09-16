import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTAL_SUPPORT_EMAIL,
  DEFAULT_PORTAL_URL,
  canonicalPortalOrigin,
  canonicalPortalUrl,
  portalSupportEmail,
} from '../../../supabase/functions/_shared/portalUrls.ts'

describe('canonicalPortalUrl e canonicalPortalOrigin', () => {
  it('retorna a origem canônica sem /portal nem barras finais', () => {
    expect(canonicalPortalOrigin()).toBe(DEFAULT_PORTAL_URL)
    expect(canonicalPortalOrigin()).toBe('https://portalfwlog.com.br')
  })

  it('usa DEFAULT_PORTAL_URL e monta caminhos limpos quando PORTAL_URL não está definida', () => {
    expect(canonicalPortalUrl()).toBe(`${DEFAULT_PORTAL_URL}/portal`)
    expect(canonicalPortalUrl('ativar?token=xyz')).toBe(`${DEFAULT_PORTAL_URL}/portal/ativar?token=xyz`)
    expect(canonicalPortalUrl('/portal/ativar?token=xyz')).toBe(`${DEFAULT_PORTAL_URL}/portal/ativar?token=xyz`)
    expect(canonicalPortalUrl('/recuperar-senha?token=abc')).toBe(`${DEFAULT_PORTAL_URL}/portal/recuperar-senha?token=abc`)
    expect(canonicalPortalUrl('billing')).toBe(`${DEFAULT_PORTAL_URL}/portal/billing`)
  })

  it('retorna e-mail padrão do Portal Fwlog', () => {
    expect(portalSupportEmail()).toBe(DEFAULT_PORTAL_SUPPORT_EMAIL)
    expect(portalSupportEmail()).toBe('suporte@portalfwlog.com.br')
  })

  it('corrige overrides legados do domínio e suporte após o cutover', () => {
    const runtime = globalThis as typeof globalThis & { Deno?: { env: { get(name: string): string | undefined } } }
    const previous = runtime.Deno
    try {
      for (const portalUrl of [
        'https://portal.transhippingdesk.com.br/portal',
        'http://www.transhippingdesk.com.br/portal',
        'www.transhippingdesk.com.br/portal',
      ]) {
        Object.defineProperty(runtime, 'Deno', {
          configurable: true,
          value: { env: { get: (name: string) => name === 'PORTAL_URL' ? portalUrl : name === 'PORTAL_SUPPORT_EMAIL' ? 'suporte@transhippingdesk.com.br' : undefined } },
        })
        expect(canonicalPortalOrigin()).toBe(DEFAULT_PORTAL_URL)
        expect(canonicalPortalUrl('ativar?token=xyz')).toBe(`${DEFAULT_PORTAL_URL}/portal/ativar?token=xyz`)
        expect(portalSupportEmail()).toBe(DEFAULT_PORTAL_SUPPORT_EMAIL)
      }
    } finally {
      if (previous) Object.defineProperty(runtime, 'Deno', { configurable: true, value: previous })
      else delete runtime.Deno
    }
  })
})
