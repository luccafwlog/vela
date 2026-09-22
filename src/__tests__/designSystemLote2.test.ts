import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('Lote 2 - Design System & Identidade Visual', () => {
  it('NAV-001: Admin é link direto no menu superior sem submenu dropdown', () => {
    const layout = readFileSync('src/components/layout/AppLayout.tsx', 'utf8')
    const nav = readFileSync('src/components/layout/appLayoutNav.ts', 'utf8')

    expect(nav).toContain("label: 'Admin'")
    expect(layout).toContain('<TopNavLink {...adminNavItem} onNavigate={closeMobileMenus} />')
    expect(layout).not.toContain('desktopAdminOpen')
    expect(layout).not.toContain('mobileAdminOpen')
  })

  it('BLD-004: Ficha do B/L utiliza componente oficial TabButton do design system', () => {
    const bld = readFileSync('src/pages/BlDetalhe.tsx', 'utf8')
    expect(bld).toContain("import { TabButton } from '../components/ui/TabButton'")
    expect(bld).toContain('<TabButton')
    expect(bld).not.toContain("border-b-2 border-[#1f6feb]")
  })

  it('CLI-001: Ficha de Clientes utiliza componente oficial TabButton', () => {
    const ficha = readFileSync('src/components/clientes/FichaTabs.tsx', 'utf8')
    expect(ficha).toContain("import { TabButton } from '../ui/TabButton'")
    expect(ficha).toContain('<TabButton')
    expect(ficha).not.toContain("bg-[#1f6feb]")
  })

  it('ALE-001 e COM-001: Tabelas de Alertas e Cobertura utilizam container app-table-scroll com bordas arredondadas e classe app-table', () => {
    const alertas = readFileSync('src/pages/Alertas.tsx', 'utf8')
    const comunicacao = readFileSync('src/pages/ClientesComunicacao.tsx', 'utf8')

    expect(alertas).toContain('app-table-scroll rounded-xl border border-[var(--app-border)] overflow-hidden')
    expect(alertas).toContain('table className="app-table text-xs"')

    expect(comunicacao).toContain('app-table-scroll rounded-xl border border-[var(--app-border)] overflow-hidden')
    expect(comunicacao).toContain('table className="app-table text-sm"')
  })

  it('VIA-001: Subcabeçalho de escala ETA/ATA na viagem não herda border-radius que corta o design com quina branca', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain('.app-voyage-table-frame .app-table thead tr:first-child > th:first-child')
    expect(css).toContain('.app-voyage-table-frame .app-table thead tr:not(:first-child) th')
  })

  it('GLO-001 e CLI-002: index.css garante contraste AA para tons âmbar no tema claro e contatos usam variáveis semânticas', () => {
    const css = readFileSync('src/index.css', 'utf8')
    expect(css).toContain(":root[data-visual-theme='light'] .text-amber-400")
    expect(css).toContain(":root[data-visual-theme='current'] .text-amber-400")

    const contatos = readFileSync('src/components/clientes/CustomerContactConfiguration.tsx', 'utf8')
    expect(contatos).not.toContain("bg-[#0d1117]")
    expect(contatos).toContain("bg-[var(--app-surface)]")
  })
})
