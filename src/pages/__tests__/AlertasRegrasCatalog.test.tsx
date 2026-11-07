// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSqlAlertCatalog } from '../../services/__tests__/alertCatalogSql'
import { ALERT_RULES } from '../../services/alertRulesCatalog'
import { AGENCY_REPORT_SECTIONS } from '../../services/agencyDepartureReport'
import type { AlertTypeSetting } from '../../services/alertTypeSettings'

const mocks = vi.hoisted(() => ({
  settings: [] as AlertTypeSetting[],
  canManage: false,
  setSeverity: vi.fn(),
  setEscalation: vi.fn(async () => ({ previousHours: null, hours: 8 })),
  confirmWithReason: vi.fn(async () => 'Exportação parada atrasa o ADR do armador' as string | null),
  showToast: vi.fn(),
  afterChange: vi.fn(async () => undefined),
  counts: new Map<string, number>(),
}))

vi.mock('../../services/alertTypeSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/alertTypeSettings')>()),
  fetchAlertTypeSettings: async () => mocks.settings,
  setAlertTypeSeverity: mocks.setSeverity,
  setAlertTypeEscalation: mocks.setEscalation,
}))
vi.mock('../../services/alerts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/alerts')>()),
  fetchAlertQueueCountsByType: async () => mocks.counts,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ can: (permission: string) => permission === 'manage_alert_rules' && mocks.canManage }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({ useConfirmWithReason: () => mocks.confirmWithReason }))
vi.mock('../../components/ui/Toast', () => ({ useToast: () => ({ showToast: mocks.showToast }) }))
vi.mock('../../services/cacheEffects', () => ({ afterGravidadeDoAlertaAlterada: mocks.afterChange }))

import { AlertasRegras } from '../AlertasRegras'

const migration323 = readFileSync(resolve(process.cwd(), 'supabase/migrations/323_agency_report_alerts_foundation.sql'), 'utf8')
const migration325 = readFileSync(resolve(process.cwd(), 'supabase/migrations/325_clientes_portal_disputes_alerts.sql'), 'utf8')
const migration338 = readFileSync(resolve(process.cwd(), 'supabase/migrations/338_alerts_review_hardening.sql'), 'utf8')
const migration342 = readFileSync(resolve(process.cwd(), 'supabase/migrations/342_atracacao_alertas.sql'), 'utf8')

function setting(type: string, severity: 'critical' | 'normal', extra: Partial<AlertTypeSetting> = {}): AlertTypeSetting {
  return { type, severity, activeItems: 0, lastChange: null, escalateAfterHours: null, lastEscalationChange: null, ...extra }
}

function renderPage(url = '/alertas/regras') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <AlertasRegras />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mocks.settings = ALERT_RULES.map((rule) => setting(rule.type, rule.severity))
  mocks.canManage = false
  mocks.counts = new Map()
  mocks.setSeverity.mockImplementation(async (type: string, severity: 'critical' | 'normal') => ({
    type, previousSeverity: severity === 'critical' ? 'normal' : 'critical', severity, activeItems: 2,
  }))
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Regras de Alertas', () => {
  it('mantém um verbete educativo para cada tipo ATIVO do catálogo SQL, e só para eles', () => {
    const active = readSqlAlertCatalog().filter((entry) => entry.active)

    expect(ALERT_RULES).toHaveLength(active.length)
    expect(new Set(ALERT_RULES.map((rule) => rule.type))).toEqual(new Set(active.map((entry) => entry.type)))

    for (const rule of ALERT_RULES) {
      expect(rule.summary).toBeTruthy()
      expect(rule.trigger).toBeTruthy()
      expect(rule.timing).toBeTruthy()
      expect(rule.resolution).toBeTruthy()
      expect(rule.impact, `${rule.type} sem "Se ninguém agir"`).toBeTruthy()
      expect(rule.destination.startsWith('/')).toBe(true)
      expect(rule.notifiedDepartments.length).toBeGreaterThan(0)
      // A dispensa do alerta saiu na migration 476 (ADR 0108): a regra não fala
      // dela. "Dispensar cobrança" da Demurrage é outra coisa (ADR 0112).
      expect(JSON.stringify(rule)).not.toMatch(/dispens\w*\s+(?:o\s+|do\s+|de\s+)?alerta|dispensa temporária|data de revisão/i)
    }
  })

  it('fala a língua de quem opera: sem migration, rotina técnica, tabela, função ou endereço de tela (ADR 0130)', () => {
    const jargon = /migration|pg_cron|pg_net|\bnet\.|cron\.|\bops\.|edge function|\bRPC\b|webhook|payload|\blease\b|\bworker\b|reconcilia[çc][ãa]o confirma|\bjob\b|ALE-D\d|\bADR \d{4}\b|`|\/[a-z]+[?/]|\b[a-z]+_[a-z_]+\b/i
    for (const rule of ALERT_RULES) {
      for (const [field, text] of Object.entries({
        summary: rule.summary, trigger: rule.trigger, timing: rule.timing, resolution: rule.resolution,
        afterResolution: rule.afterResolution, impact: rule.impact, routingNote: rule.routingNote ?? '',
        destinationNote: rule.destinationNote ?? '',
      })) {
        expect(text, `${rule.type}.${field}`).not.toMatch(jargon)
      }
    }
  })

  it('não lista os tipos aposentados, que não têm produtor desde as migrations 327, 347 e 348', () => {
    const retired = readSqlAlertCatalog().filter((entry) => !entry.active).map((entry) => entry.type)

    expect(retired.length).toBeGreaterThan(0)
    for (const type of retired) {
      expect(ALERT_RULES.find((rule) => rule.type === type)).toBeUndefined()
    }
  })

  it('espelha a gravidade de fábrica e a audiência do alert_type_catalog em cada verbete', () => {
    for (const entry of readSqlAlertCatalog().filter((item) => item.active)) {
      const rule = ALERT_RULES.find((item) => item.type === entry.type)
      expect(rule, `Tipo ${entry.type} não tem verbete`).toBeDefined()
      expect(rule!.severity).toBe(entry.severity)
      expect([...rule!.catalogAudience].sort()).toEqual([...entry.audienceDepartments].sort())
      // fanout_alert_item_for_department une a audiência do catálogo ao
      // departamento gravado no item: nenhum dos dois pode ficar de fora.
      for (const department of entry.audienceDepartments) {
        expect(rule!.notifiedDepartments).toContain(department)
      }
      for (const department of rule!.responsibleDepartments) {
        expect(rule!.notifiedDepartments).toContain(department)
      }
    }
  })

  it('documenta o ADR como alerta por departamento, incluindo Equipamentos', () => {
    const pending = ALERT_RULES.find((rule) => rule.type === 'agency_report_department_pending')!
    const deadline = ALERT_RULES.find((rule) => rule.type === 'agency_report_deadline_missed')!
    const equipmentSections = Object.entries(AGENCY_REPORT_SECTIONS)
      .filter(([, owner]) => owner === 'equipamentos')
      .map(([section]) => section)

    // O detector abre um item por departamento (migrations 323 e 342).
    expect(migration323).toContain("unnest(ARRAY['operacoes', 'documentacao', 'equipamentos'])")
    expect(migration342).toContain("'agency_report_department_pending', 'agency_departure_report'")
    expect(equipmentSections.sort()).toEqual(['carga_carregada', 'vazios_embarcados', 'veiculos'])

    for (const rule of [pending, deadline]) {
      expect(rule.responsibleDepartments.sort()).toEqual(['documentacao', 'equipamentos', 'operacoes'])
      expect(rule.notifiedDepartments).toContain('equipamentos')
      expect(rule.notifiedDepartments).toContain('operacoes')
      expect(rule.routingNote).toContain('Equipamentos')
    }
    expect(pending.trigger).toContain('Veículos')
  })

  it('sino só do setor responsável, com o Financeiro avisado nos tipos da exceção (migrations 476 e 495)', () => {
    const pix = ALERT_RULES.find((rule) => rule.type === 'pix_unreconciled')!
    const schedule = ALERT_RULES.find((rule) => rule.type === 'voyage_schedule_date_pending')!
    const terminal = ALERT_RULES.find((rule) => rule.type === 'voyage_terminal_date_pending')!
    const portal = ALERT_RULES.find((rule) => rule.type === 'review_portal_not_ready')!

    // ALE-D03: um setor responsável. Desde a 587 o Pix é do Financeiro e o
    // Administrativo não é mais avisado; a Fatura desatualizada segue com ele.
    const invoice = ALERT_RULES.find((rule) => rule.type === 'fatura_desatualizada')!
    expect(pix.responsibleDepartments).toEqual(['financeiro'])
    expect(pix.notifiedDepartments).toEqual(['financeiro'])
    expect(invoice.responsibleDepartments).toEqual(['administrativo'])
    expect(invoice.notifiedDepartments).toEqual(['financeiro', 'administrativo'])
    expect(ALERT_RULES.filter((rule) => rule.responsibleDepartments.includes('financeiro')).map((rule) => rule.type).sort())
      // 620: a Consulta Itaú parada é técnica e vai só à conta Dev.
      .toEqual(['pix_unreconciled', 'restituicao_pendente'])
    expect(schedule.notifiedDepartments).toEqual(['operacoes'])
    expect(terminal.notifiedDepartments).toEqual(['operacoes'])
    // 605: o Administrativo também é avisado (concede a Liberação).
    expect(portal.notifiedDepartments).toEqual(['documentacao', 'administrativo'])
    expect(ALERT_RULES.filter((rule) => rule.notifiedDepartments.includes('financeiro')).map((rule) => rule.type).sort())
      .toEqual(['fatura_desatualizada', 'pix_unreconciled', 'restituicao_pendente', 'taxa_alterada_mudou'])
  })

  it('filtra o catálogo por setor notificado, não apenas pelo responsável', () => {
    renderPage('/alertas/regras?visao=lista')
    // A ficha da regra escolhida também cita outros alertas na cadeia: conta só a lista.
    const list = () => within(screen.getByRole('list', { name: 'Regras de alertas' }))

    expect(screen.getByText('65 regras')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor avisado' }), { target: { value: 'equipamentos' } })

    // 605: a PTAX e a exportação pós-ATD passaram a Equipamentos; 607: Container sem descarga.
    expect(screen.getByText('10 regras')).toBeTruthy()
    expect(list().getByRole('button', { name: /Falha na atualização da PTAX Demurrage/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /Exportação pendente pós-ATD/ })).toBeTruthy()
    // Planilha de Veículos ausente (migration 468), o prazo da Disputa de
    // Demurrage (migration 520) e a Declaração de veículos pendente (597) são
    // de Equipamentos.
    expect(list().getByRole('button', { name: /Disputa de Demurrage sem resposta no prazo/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /Planilha de Veículos ausente/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /Declaração de veículos pendente/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /ADR — departamento pendente/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /ADR — prazo vencido/ })).toBeTruthy()
    // Desde a migration 476 o Pix não avisa mais Equipamentos.
    expect(list().queryByRole('button', { name: /PIX sem conciliação segura/ })).toBeNull()
    expect(list().getByRole('button', { name: /Disputa de invoice Demurrage/ })).toBeTruthy()

    // Filtro específico para regras aplicáveis a todos os setores simultaneamente
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor avisado' }), { target: { value: 'todos' } })
    expect(screen.getByText('2 regras')).toBeTruthy()
    expect(list().getByRole('button', { name: /ADR — departamento pendente/ })).toBeTruthy()
    expect(list().getByRole('button', { name: /ADR — prazo vencido/ })).toBeTruthy()
    expect(list().queryByRole('button', { name: /PIX sem conciliação segura/ })).toBeNull()
    expect(list().queryByRole('button', { name: /Disputa de invoice Demurrage/ })).toBeNull()

    // Retorna para qualquer setor (sem filtro de setor)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor avisado' }), { target: { value: 'all' } })
    expect(screen.getByText('65 regras')).toBeTruthy()
  })

  it('ignora um deep-link para um tipo aposentado e cai na primeira regra viva', () => {
    renderPage('/alertas/regras?visao=lista&regra=invoice_cancel_blocked')

    expect(screen.queryByRole('heading', { name: 'Cancelamento bloqueado' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cancelamento bloqueado/ })).toBeNull()
    expect(screen.getByText('65 regras')).toBeTruthy()
  })

  it('agrupa pelos assuntos do capítulo 20 do manual e limpa a combinação de filtros sem perder a regra selecionada', () => {
    renderPage('/alertas/regras?visao=lista')

    fireEvent.change(screen.getByRole('combobox', { name: 'Assunto' }), { target: { value: 'Cliente e Portal' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Gravidade' }), { target: { value: 'critical' } })

    expect(screen.getByText('6 regras')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Portal do Cliente — convite expirado/ })).toBeNull()
    // O provedor de e-mail sem retorno é rotina parada, não assunto do Cliente.
    expect(screen.queryByRole('button', { name: /Provedor de e-mail sem retorno/ })).toBeNull()

    const clearButton = screen.getByRole('button', { name: 'Limpar filtros' })
    expect((clearButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(clearButton)

    expect(screen.getByText('65 regras')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Assunto' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('combobox', { name: 'Gravidade' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('button', { name: 'Limpar filtros' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('abre uma regra por deep-link com o que é, o que acontece se ninguém agir e onde se resolve', () => {
    renderPage('/alertas/regras?visao=lista&regra=voyage_baplie_missing')

    expect(screen.getByRole('heading', { name: 'Baplie ausente' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Regras de alertas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Baplie ausente/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: 'Abrir Baplie EDI' }).getAttribute('href')).toBe('/baplie')
    // Lote 5a: sem o código interno da regra e o endereço da tela à mostra.
    expect(screen.queryByText('voyage_baplie_missing')).toBeNull()
    expect(screen.queryByText('/baplie')).toBeNull()
    for (const heading of ['O que é', 'Quando abre e quando fecha', 'Quem recebe', 'Como resolver', 'Gravidade', 'Reforço por tempo']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy()
    }
    expect(within(screen.getByRole('heading', { name: 'O que é' }).closest('section')!).getByText('Se ninguém agir')).toBeTruthy()
    expect(screen.getByText(/os B\/Ls não recebem as marcas IMO e OOG/)).toBeTruthy()
  })

  it('mantém as entidades e as etapas de data alinhadas aos detectores vigentes', () => {
    const exportRule = ALERT_RULES.find((rule) => rule.type === 'voyage_export_after_atd')!
    const scheduleRule = ALERT_RULES.find((rule) => rule.type === 'voyage_schedule_date_pending')!
    const terminalRule = ALERT_RULES.find((rule) => rule.type === 'voyage_terminal_date_pending')!
    const reprocessRule = ALERT_RULES.find((rule) => rule.type === 'portal_reprocessamento_falhou')!

    expect(exportRule.entityType).toBe('voyage_pod_schedule')
    expect(migration338).toContain("'voyage_export_after_atd', 'voyage_pod_schedule'")

    // Depois da 342 o ETD virou data do terminal: a escala cobra ATA e ETB,
    // e a atracação cobra ATB, ETD e ATD.
    expect(migration342).toContain("'ETD pendente no terminal para a escala '")
    expect(scheduleRule.trigger).toContain('ATA')
    expect(scheduleRule.trigger).toContain('ETB')
    expect(scheduleRule.trigger).not.toContain('ETD previsto para a escala')
    expect(terminalRule.trigger).toContain('ATB')
    expect(terminalRule.trigger).toContain('ETD')
    expect(terminalRule.trigger).toContain('ATD')

    // O alerta abre a aba Faturamento do B/L (325); a tela diz isso sem o endereço.
    expect(reprocessRule.destination).toBe('/bls')
    expect(reprocessRule.destinationNote).toContain('aba Faturamento do B/L')
    expect(migration325).toContain("'/manifestos/' || v_bl.id || '?tab=faturamento'")
  })
})

describe('Gravidade pela tela (migration 603, ADR 0130)', () => {
  it('mostra a gravidade vigente do banco, não a de fábrica, na lista, no filtro e no detalhe', async () => {
    mocks.settings = mocks.settings.map((item) => item.type === 'voyage_export_after_atd'
      ? setting(item.type, 'critical', {
          activeItems: 3,
          lastChange: { at: '2026-11-06T13:00:00Z', byName: 'Ana Administrativo', previousSeverity: 'normal', reason: 'Exportação parada atrasa o ADR' },
        })
      : item)
    renderPage('/alertas/regras?regra=voyage_export_after_atd&gravidade=critical')

    const detail = await screen.findByRole('heading', { name: 'Gravidade' })
    const block = detail.closest('section')!
    await waitFor(() => expect(within(block).getByText('3 alertas')).toBeTruthy())
    expect(within(block).getByText('Crítico')).toBeTruthy()
    expect(within(block).getByText('Normal')).toBeTruthy() // de fábrica
    expect(within(block).getByText('06/11/2026 às 10:00, por Ana Administrativo')).toBeTruthy()
    expect(within(block).getByText('Motivo (era Normal): Exportação parada atrasa o ADR')).toBeTruthy()
    // Com a gravidade vigente Crítica, a regra entra no filtro de críticos.
    expect(screen.getByRole('button', { name: /Exportação pendente pós-ATD/ })).toBeTruthy()
    // Crítico sem ninguém ativo no setor vai ao Administrativo.
    expect(screen.getByText('Se ninguém de Equipamentos estiver ativo, o aviso vai ao Administrativo.')).toBeTruthy()
  })

  it('quem não é do Administrativo vê a gravidade, mas não o botão de trocar', async () => {
    renderPage('/alertas/regras?regra=voyage_baplie_missing')

    await waitFor(() => expect(screen.getByText('0 alertas')).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Trocar para/ })).toBeNull()
    expect(screen.getByText('Só o Administrativo troca a gravidade, com motivo.')).toBeTruthy()
  })

  it('o Administrativo troca Crítico para Normal com motivo, e a tela relê a fila e os cartões', async () => {
    mocks.canManage = true
    mocks.settings = mocks.settings.map((item) => item.type === 'voyage_baplie_missing' ? setting(item.type, 'critical', { activeItems: 2 }) : item)
    renderPage('/alertas/regras?regra=voyage_baplie_missing')

    const button = await screen.findByRole('button', { name: 'Trocar para Normal' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)

    await waitFor(() => expect(mocks.setSeverity).toHaveBeenCalledWith('voyage_baplie_missing', 'normal', 'Exportação parada atrasa o ADR do armador'))
    const options = (mocks.confirmWithReason.mock.calls as unknown as Array<[{ message: string; consequence: string; confirmLabel: string }]>)[0][0]
    expect(options.message).toBe('Trocar a gravidade de "Baplie ausente" de Crítico para Normal?')
    expect(options.consequence).toContain('2 alertas abertos deste tipo passam a Normal agora')
    expect(options.consequence).toContain('o aviso deixa de ir ao Administrativo')
    expect(options.confirmLabel).toBe('Trocar para Normal')
    await waitFor(() => expect(mocks.afterChange).toHaveBeenCalled())
    expect(mocks.showToast).toHaveBeenCalledWith('Baplie ausente agora é Normal. 2 alertas abertos mudaram junto.', 'success')
  })

  it('desistir na confirmação não troca nada', async () => {
    mocks.canManage = true
    mocks.confirmWithReason.mockResolvedValueOnce(null)
    renderPage('/alertas/regras?regra=voyage_schedule_date_pending')

    const button = await screen.findByRole('button', { name: 'Trocar para Crítico' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)

    await waitFor(() => expect(mocks.confirmWithReason).toHaveBeenCalled())
    expect(mocks.setSeverity).not.toHaveBeenCalled()
    expect(mocks.afterChange).not.toHaveBeenCalled()
  })

  it('o Administrativo define o reforço por tempo de um alerta Normal, com motivo (migration 604)', async () => {
    mocks.canManage = true
    renderPage('/alertas/regras?regra=voyage_schedule_date_pending')

    const open = await screen.findByRole('button', { name: 'Definir reforço' })
    expect(screen.getByText('Sem reforço por tempo')).toBeTruthy()
    fireEvent.click(open)
    const save = screen.getByRole('button', { name: 'Salvar reforço' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Horas (de 1 a 720)'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText(/Motivo da troca/), { target: { value: 'Data esquecida atrasa o NOR' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)

    await waitFor(() => expect(mocks.setEscalation).toHaveBeenCalledWith('voyage_schedule_date_pending', 8, 'Data esquecida atrasa o NOR'))
    await waitFor(() => expect(mocks.afterChange).toHaveBeenCalled())
  })

  it('mostra o reforço vigente e não oferece a troca a quem não é do Administrativo', async () => {
    mocks.settings = mocks.settings.map((item) => item.type === 'voyage_schedule_date_pending' ? setting(item.type, 'normal', { escalateAfterHours: 16 }) : item)
    renderPage('/alertas/regras?regra=voyage_schedule_date_pending')

    expect(await screen.findByText('Vira Crítico depois de 16 horas aberto')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /reforço/ })).toBeNull()
    expect(screen.getByText('Só o Administrativo define o reforço, com motivo.')).toBeTruthy()
  })
})

describe('Mapa dos alertas (ADR 0134)', () => {
  it('abre no mapa, na ordem da viagem, ensinando a ler antes de escolher', () => {
    renderPage()

    expect(screen.getByRole('radio', { name: 'Mapa' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('region', { name: 'D−7: Baplie, B/Ls e Revisão' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Bastidores: Rotinas, só a conta Dev' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Como ler o mapa' })).toBeTruthy()
    expect(screen.getByText(/64 alertas e 5 avisos em 12 momentos/)).toBeTruthy()
    // Veículos alterados na reimportação não abre mais: fica só na lista.
    expect(screen.queryByRole('button', { name: /Veículos alterados na reimportação/ })).toBeNull()
  })

  it('o cartão abre a ficha com a cadeia, e a cadeia leva ao alerta seguinte', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^CE Mercante pendente/ }))
    expect(screen.getByRole('heading', { name: 'CE Mercante pendente', level: 2 })).toBeTruthy()
    const before = screen.getByRole('list', { name: 'Vem antes' })
    expect(within(before).getByRole('button', { name: 'Declaração de veículos pendente' })).toBeTruthy()
    expect(within(before).getByRole('button', { name: 'Rotina interna sem rodar' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Se ninguém agir' })).getByRole('button', { name: 'Demurrage travada' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Em seguida, pode abrir' })).getByRole('button', { name: 'Falha de emissão automática' })).toBeTruthy()

    fireEvent.click(within(before).getByRole('button', { name: 'Declaração de veículos pendente' }))
    expect(screen.getByRole('heading', { name: 'Declaração de veículos pendente', level: 2 })).toBeTruthy()
    // O que fica parado leva à lista de quem segura.
    fireEvent.click(screen.getByRole('button', { name: 'CE Mercante' }))
    expect(screen.getByRole('heading', { name: 'CE Mercante', level: 2 })).toBeTruthy()
  })

  it('o que fica parado lista quem pode segurar, de todas as equipes', () => {
    renderPage()

    fireEvent.click(within(screen.getByRole('group', { name: 'O que fica parado' })).getByRole('button', { name: /Desbloqueio de CE/ }))
    expect(screen.getByRole('heading', { name: 'Desbloqueio de CE', level: 2 })).toBeTruthy()
    expect(screen.getByText(/14 alertas podem segurar/)).toBeTruthy()
    const aside = screen.getByRole('complementary', { name: 'Ficha' })
    expect(within(aside).getByRole('button', { name: 'PIX sem conciliação segura' })).toBeTruthy()
    expect(within(aside).getByRole('button', { name: 'Calendário de feriados pendente' })).toBeTruthy()
  })

  it('"E se ninguém agir?" mostra a cascata passo a passo até o que fica parado', () => {
    renderPage('/alertas/regras?regra=voyage_vehicle_declaration_pending')

    fireEvent.click(screen.getByRole('button', { name: 'E se ninguém agir?' }))
    const bar = screen.getByRole('region', { name: 'E se ninguém agir?' })
    expect(within(bar).getByText('Passo 1 de 4')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Próximo passo' }))
    expect(within(bar).getByText(/Sem resposta até o D−5/)).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Próximo passo' }))
    expect(within(bar).getByText('B/L sem CE Mercante trava a Demurrage do grupo.', { exact: false })).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Próximo passo' }))
    expect(within(bar).getByText(/CE Mercante, Fatura de Taxas Locais, Avisos e e-mails ao Cliente, Portal do Cliente, Desbloqueio de CE, Cobrança de Demurrage/)).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Encerrar' }))
    expect(screen.queryByRole('region', { name: 'E se ninguém agir?' })).toBeNull()
  })

  it('mostra quantos a pessoa tem na fila e leva à fila filtrada no tipo', async () => {
    mocks.counts = new Map([['voyage_ce_mercante_missing', 3]])
    renderPage()

    const link = await screen.findByRole('link', { name: '3 na fila' })
    expect(link.getAttribute('href')).toBe('/alertas?tipo=voyage_ce_mercante_missing')
  })

  it('os avisos do sino entram como marcos, sem gravidade, com a cadeia', () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /^Nova solicitação de desbloqueio de CE/ }))
    expect(screen.getByRole('heading', { name: 'Nova solicitação de desbloqueio de CE', level: 2 })).toBeTruthy()
    expect(screen.getByText('Documentação e Administrativo')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Se ninguém agir' })).getByRole('button', { name: 'Solicitação de desbloqueio sem análise' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Gravidade' })).toBeNull()
  })

  it('a conta Dev é um setor do filtro, e o técnico só dela não conta para o Administrativo', () => {
    renderPage('/alertas/regras?visao=lista&setor=dev')

    expect(screen.getByText('14 regras')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor avisado' }), { target: { value: 'administrativo' } })
    const list = within(screen.getByRole('list', { name: 'Regras de alertas' }))
    expect(list.queryByRole('button', { name: /Rotina interna sem rodar/ })).toBeNull()
    expect(list.getByRole('button', { name: /Liberação de faturamento vencendo/ })).toBeTruthy()
  })
})
