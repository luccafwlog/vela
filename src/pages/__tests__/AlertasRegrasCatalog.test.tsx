// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { readSqlAlertCatalog } from '../../services/__tests__/alertCatalogSql'
import { ALERT_RULES } from '../../services/alertRulesCatalog'
import { AGENCY_REPORT_SECTIONS } from '../../services/agencyDepartureReport'
import { AlertasRegras } from '../AlertasRegras'

const migration323 = readFileSync(resolve(process.cwd(), 'supabase/migrations/323_agency_report_alerts_foundation.sql'), 'utf8')
const migration325 = readFileSync(resolve(process.cwd(), 'supabase/migrations/325_clientes_portal_disputes_alerts.sql'), 'utf8')
const migration338 = readFileSync(resolve(process.cwd(), 'supabase/migrations/338_alerts_review_hardening.sql'), 'utf8')
const migration342 = readFileSync(resolve(process.cwd(), 'supabase/migrations/342_atracacao_alertas.sql'), 'utf8')

afterEach(cleanup)

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
      expect(rule.destination.startsWith('/')).toBe(true)
      expect(rule.notifiedDepartments.length).toBeGreaterThan(0)
      expect(rule.dismissal).toContain('motivo obrigatório')
    }
  })

  it('não lista os tipos aposentados, que não têm produtor desde as migrations 327, 347 e 348', () => {
    const retired = readSqlAlertCatalog().filter((entry) => !entry.active).map((entry) => entry.type)

    expect(retired.length).toBeGreaterThan(0)
    for (const type of retired) {
      expect(ALERT_RULES.find((rule) => rule.type === type)).toBeUndefined()
    }
  })

  it('espelha gravidade e audiência do alert_type_catalog em cada verbete', () => {
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

  it('documenta os alertas que chegam a mais de um setor', () => {
    const pix = ALERT_RULES.find((rule) => rule.type === 'pix_unreconciled')!
    const schedule = ALERT_RULES.find((rule) => rule.type === 'voyage_schedule_date_pending')!
    const terminal = ALERT_RULES.find((rule) => rule.type === 'voyage_terminal_date_pending')!

    // Migration 078: o Administrativo trata (só ele abre a Conciliação PIX);
    // Documentação e Equipamentos continuam avisados.
    expect(pix.responsibleDepartments).toEqual(['administrativo'])
    expect(pix.notifiedDepartments).toEqual(['documentacao', 'equipamentos', 'administrativo'])
    expect(schedule.notifiedDepartments).toEqual(['documentacao', 'operacoes'])
    expect(terminal.notifiedDepartments).toEqual(['documentacao', 'operacoes'])
    expect(schedule.responsibleDepartments).toEqual(['operacoes'])
  })

  it('filtra o catálogo por setor notificado, não apenas pelo responsável', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.getByText('30 regras encontradas')).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor notificado' }), { target: { value: 'equipamentos' } })

    expect(screen.getByText('4 regras encontradas')).toBeTruthy()
    expect(screen.getByRole('button', { name: /ADR — departamento pendente/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ADR — prazo vencido/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PIX sem conciliação segura/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Disputa de invoice Demurrage/ })).toBeTruthy()

    // Filtro específico para regras aplicáveis a todos os setores simultaneamente
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor notificado' }), { target: { value: 'todos' } })
    expect(screen.getByText('2 regras encontradas')).toBeTruthy()
    expect(screen.getByRole('button', { name: /ADR — departamento pendente/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /ADR — prazo vencido/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /PIX sem conciliação segura/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Disputa de invoice Demurrage/ })).toBeNull()

    // Retorna para qualquer setor (sem filtro de setor)
    fireEvent.change(screen.getByRole('combobox', { name: 'Setor notificado' }), { target: { value: 'all' } })
    expect(screen.getByText('30 regras encontradas')).toBeTruthy()
  })

  it('ignora um deep-link para um tipo aposentado e cai na primeira regra viva', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras?regra=invoice_cancel_blocked']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('heading', { name: 'Cancelamento bloqueado' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Cancelamento bloqueado/ })).toBeNull()
    expect(screen.getByText('30 regras encontradas')).toBeTruthy()
  })

  it('combina filtros no topo e limpa a combinação sem perder a regra selecionada', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Domínio' }), { target: { value: 'Portal' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Gravidade' }), { target: { value: 'critical' } })

    expect(screen.getByText('4 regras encontradas')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Portal do Cliente — convite expirado/ })).toBeNull()

    const clearButton = screen.getByRole('button', { name: 'Limpar filtros' })
    expect((clearButton as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(clearButton)

    expect(screen.getByText('30 regras encontradas')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Domínio' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('combobox', { name: 'Gravidade' }) as HTMLSelectElement).value).toBe('all')
    expect((screen.getByRole('button', { name: 'Limpar filtros' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('abre uma regra por deep-link e aponta para a tela de tratamento', () => {
    render(
      <MemoryRouter initialEntries={['/alertas/regras?regra=voyage_baplie_missing']}>
        <AlertasRegras />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Baplie ausente' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Regras de alertas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Baplie ausente/ }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByRole('link', { name: /Abrir tela de resolução/ }).getAttribute('href')).toBe('/baplie')
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

    expect(reprocessRule.destination).toBe('/bls')
    expect(reprocessRule.destinationNote).toContain('/bls/{id}?tab=faturamento')
    expect(migration325).toContain("'/manifestos/' || v_bl.id || '?tab=faturamento'")
  })
})
