import { describe, expect, it } from 'vitest'
import { buildAdrHistoryRows, buildDepartmentTimelineRows } from '../AgencyReportTimeline'

// Testa só a função pura de mapeamento (ADR 0039): não monta o componente,
// segue a mesma convenção de agencyReportDeadline.test.ts para lógica sem UI.

describe('buildDepartmentTimelineRows', () => {
  it('sem ATD: todos os departamentos ficam sem prazo, sem cor de veredito', () => {
    const rows = buildDepartmentTimelineRows({
      atd: null,
      omitted: false,
      now: '2026-08-06T12:00:00Z',
      departmentSignoffs: [],
      departmentEvents: [],
      actorNames: {},
    })

    expect(rows).toHaveLength(3)
    for (const row of rows) expect(row.state).toBe('no-deadline')
  })

  it('escala omitida: sem prazo mesmo com ATD e assinatura presentes', () => {
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: true,
      now: '2026-08-06T12:00:00Z',
      departmentSignoffs: [{ id: 'ds-1', department: 'operacoes', signed_by: 'u1', signed_at: '2026-08-10T09:00:00Z' } as never],
      departmentEvents: [],
      actorNames: {},
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.state).toBe('no-deadline')
  })

  it('departamento assinado no prazo fica on-time; departamento sem assinatura e prazo vencido fica overdue', () => {
    // ATD 2026-08-03 (segunda) -> prazo 2026-08-06 (quinta).
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: false,
      now: '2026-08-10T12:00:00Z',
      departmentSignoffs: [
        { id: 'ds-1', department: 'operacoes', signed_by: 'u1', signed_at: '2026-08-05T09:00:00Z' } as never,
      ],
      departmentEvents: [],
      actorNames: { u1: 'Ana Ribeiro' },
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.state).toBe('on-time')
    expect(operacoes.signedByName).toBe('Ana Ribeiro')

    const documentacao = rows.find((row) => row.department === 'documentacao')!
    expect(documentacao.state).toBe('overdue')
    expect(documentacao.signedAt).toBeNull()
  })

  it('reabertura (new_value=false) aparece com justificativa; (re)assinatura simples (new_value=true) não vira reabertura', () => {
    const rows = buildDepartmentTimelineRows({
      atd: '2026-08-03',
      omitted: false,
      now: '2026-08-10T12:00:00Z',
      departmentSignoffs: [],
      departmentEvents: [
        {
          id: 1, department: 'equipamentos', old_value: 'true', new_value: 'false',
          justification: 'Container avariado, corrigindo contagem.', changed_by: 'u2', changed_at: '2026-08-07T10:00:00Z',
        },
        {
          id: 2, department: 'equipamentos', old_value: 'false', new_value: 'true',
          justification: null, changed_by: 'u2', changed_at: '2026-08-08T10:00:00Z',
        },
        {
          id: 3, department: 'operacoes', old_value: 'true', new_value: 'false',
          justification: 'Outro motivo', changed_by: 'u3', changed_at: '2026-08-07T11:00:00Z',
        },
      ],
      actorNames: { u2: 'Bruno Alves' },
    })

    const equipamentos = rows.find((row) => row.department === 'equipamentos')!
    expect(equipamentos.reopenings).toHaveLength(1)
    expect(equipamentos.reopenings[0]).toEqual({
      changedAt: '2026-08-07T10:00:00Z',
      changedByName: 'Bruno Alves',
      justification: 'Container avariado, corrigindo contagem.',
    })

    const operacoes = rows.find((row) => row.department === 'operacoes')!
    expect(operacoes.reopenings).toHaveLength(1)
    expect(operacoes.reopenings[0].changedByName).toBe('u3')
  })
})

describe('buildAdrHistoryRows', () => {
  it('lista só o que aconteceu, em ordem, com o prazo de cada assinatura e a justificativa da reabertura', () => {
    const rows = buildAdrHistoryRows({
      atd: '2026-10-13T18:40:00-03:00',
      atdSource: 'terminal',
      atdRegisteredAt: '2026-10-13T21:45:00Z',
      omitted: false,
      departmentSignoffs: [
        { id: 'ds-1', department: 'operacoes', signed_by: 'u1', signed_at: '2026-10-14T13:32:00Z' } as never,
        // Assinatura sem trilha (anterior à migration 223) entra pela linha vigente.
        { id: 'ds-2', department: 'documentacao', signed_by: 'u3', signed_at: '2026-10-17T12:00:00Z' } as never,
      ],
      departmentEvents: [
        { id: 3, department: 'operacoes', old_value: 'false', new_value: 'true', justification: null, changed_by: 'u1', changed_at: '2026-10-14T13:32:00Z' },
        { id: 1, department: 'operacoes', old_value: null, new_value: 'true', justification: null, changed_by: 'u1', changed_at: '2026-10-14T12:10:00Z' },
        { id: 2, department: 'operacoes', old_value: 'true', new_value: 'false', justification: 'Restow corrigido para 4', changed_by: 'u2', changed_at: '2026-10-14T12:55:00Z' },
      ],
      actorNames: { u1: 'Ana Ribeiro', u2: 'Carlos Lima' },
      closedAt: null,
      closedByName: null,
    })

    expect(rows.map((row) => row.label)).toEqual([
      'Saída do navio (ATD)',
      'Assinatura · Operações',
      'Reabertura · Operações',
      'Assinatura · Operações',
      'Assinatura · Documentação',
    ])
    expect(rows[0].detail).toBe('registrado em 13/10/2026 18:45 (Atracação)')
    expect(rows[2]).toMatchObject({ by: 'Carlos Lima', deadline: null, detail: 'Restow corrigido para 4' })
    expect(rows[3].deadline).toBe('on-time')
    // Prazo 16/10 21:40Z; assinou 17/10.
    expect(rows[4]).toMatchObject({ by: 'u3', deadline: 'overdue' })
  })
})
