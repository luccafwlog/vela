import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (relativePath: string) => readFileSync(path.join(repositoryRoot, relativePath), 'utf8')

describe('aplicação da identidade Vela', () => {
  it('mantém os assets novos dentro de public/branding', () => {
    for (const relativePath of [
      'public/branding/vela-mark.svg',
      'public/branding/vela-mark-dark.svg',
      'public/branding/vela-icon.svg',
      'public/branding/vela-icon-16.svg',
      'public/branding/vela-icon-16.png',
      'public/branding/vela-icon-32.png',
      'public/branding/vela-icon-180.png',
      'public/branding/vela-icon-192.png',
      'public/branding/vela-icon-512.png',
      'public/branding/fwlog-logo.png',
      'public/branding/fwlog-logo-white.png',
      'public/branding/fwlog-icon.png',
    ]) {
      expect(existsSync(path.join(repositoryRoot, relativePath)), relativePath).toBe(true)
    }
  })

  it('reponta apenas a superfície interna para os assets Vela', () => {
    expect(read('index.html')).toContain('/branding/vela-icon.svg')
    expect(read('index.html')).toContain('/branding/vela-icon-32.png')
    expect(read('public/site.webmanifest')).toContain('/branding/vela-icon-192.png')
    expect(read('src/components/layout/AppLayout.tsx')).toContain('/branding/vela-mark-dark.svg')
    expect(read('src/pages/Login.tsx')).toContain('app-auth__logo--vela')
    expect(read('src/pages/Login.tsx')).toContain('/branding/vela-mark-dark.svg')
    expect(read('src/pages/LineUpTVDisplay.tsx')).toContain('/branding/vela-mark.svg')
  })

  it('não reponta o Portal nem os documentos protegidos', () => {
    expect(read('portal.html')).toContain('/favicon.ico')
    expect(read('public/portal.webmanifest')).toContain('/android-chrome-192x192.png')
    for (const relativePath of [
      'src/components/layout/PortalLayout.tsx',
      'src/components/billing/InvoiceDocumentLocal.tsx',
      'src/components/demurrage/InvoiceDocument.tsx',
      'src/components/demurrage/CustomerSummaryReport.tsx',
      'src/components/voyages/AgencyReportDocument.tsx',
    ]) {
      expect(read(relativePath)).not.toContain('/branding/vela-')
    }
  })
})
