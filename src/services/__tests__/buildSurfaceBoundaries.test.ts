import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (relativePath: string) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('fronteiras dos builds Vela e Fwlog', () => {
  it('declara duas entradas HTML, React e roteador independentes', () => {
    for (const relativePath of [
      'portal.html',
      'src/portal-main.tsx',
      'src/AppInterno.tsx',
      'src/AppPortal.tsx',
      'src/components/PortalErrorBoundary.tsx',
      'src/lib/portalQueryClient.ts',
      'public/portal.webmanifest',
    ]) {
      expect(existsSync(path.join(repositoryRoot, relativePath)), relativePath).toBe(true)
    }

    expect(read('index.html')).toContain('/src/main.tsx')
    expect(read('portal.html')).toContain('/src/portal-main.tsx')
    expect(read('src/main.tsx')).not.toContain('PortalAuthProvider')
    expect(read('src/main.tsx')).toContain("from './hooks/useVisualTheme'")
    expect(read('src/portal-main.tsx')).not.toContain("from './hooks/useAuth'")
    expect(read('src/portal-main.tsx')).not.toContain("from './hooks/useVisualTheme'")
    expect(read('src/portal-main.tsx')).toContain("from './components/PortalErrorBoundary'")
    expect(read('src/portal-main.tsx')).toContain("from './lib/portalQueryClient'")
    expect(read('src/portal-main.tsx')).not.toContain("from './components/ErrorBoundary'")
    expect(read('src/portal-main.tsx')).not.toContain("from './lib/queryClient'")
  })

  it('não inclui rotas da outra superfície em cada mapa de rotas', () => {
    const internalRoutes = read('src/AppInterno.tsx')
    const portalRoutes = read('src/AppPortal.tsx')

    expect(internalRoutes).toContain('path="/painel"')
    expect(internalRoutes).not.toContain('path="/portal/login"')
    expect(portalRoutes).toContain('path="/portal/login"')
    expect(portalRoutes).not.toContain('path="/painel"')
    expect(portalRoutes).not.toContain('path="/admin"')
  })

  it('mantém os links de faturamento no caminho canônico do Portal', () => {
    expect(read('.env.example')).toContain('VITE_PORTAL_BILLING_URL=https://portalfwlog.com.br/portal/billing')
    expect(read('src/services/customerFinanceCommunications.ts')).toContain('canonicalPortalBillingUrl(portal)')
    expect(read('src/services/customerCommunicationTemplates.ts')).toContain("https://portalfwlog.com.br/portal/billing")
    expect(read('src/services/emailLayout.ts')).toContain("https://portalfwlog.com.br'")
    expect(read('supabase/functions/demurrage-dunning/index.ts')).toContain('`${configured}/portal/billing`')
    expect(read('supabase/functions/send-customer-communication/index.ts')).toContain('`${configured}/portal/billing`')
    expect(read('supabase/functions/_shared/portalEmailEventProcessor.ts')).toContain('canonicalPortalOrigin')
    expect(read('supabase/functions/portal-invite-send/index.ts')).toContain('canonicalPortalUrl')
    expect(read('supabase/functions/portal-password-recovery/index.ts')).toContain('canonicalPortalUrl')
    expect(read('supabase/functions/portal-recovery-email-change/index.ts')).toContain('canonicalPortalUrl')
  })
})
