import { describe, expect, it } from 'vitest'
import { buildVoyageTimeline } from '../../services/voyageSummaries'

describe('buildVoyageTimeline (US-220 carregar timeline)', () => {
  it('humaniza importacoes, CE Master, cobertura de CE e import Baplie', () => {
    const events = buildVoyageTimeline({
      importBatches: [
        { id: 1, filename: 'manifesto.edi', cargo_mode: 'container', uploaded_at: '2026-06-01T10:00:00Z', route: 'BRSSZ-BRVIX', ce_master: 'CE-123' },
      ],
      ceCoverage: { filled: 2, total: 2 },
      baplieImports: [{ imported_at: '2026-06-02T08:00:00Z', container_count: 10 }],
      openDivergenceCount: 0,
    })

    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('import')
    expect(kinds).toContain('ce-coverage')
    expect(kinds).toContain('baplie-import')

    // Nº de Manifesto Mercante do lote no evento da importação (F2).
    expect(kinds).not.toContain('ce-master')
    expect(events.find((e) => e.kind === 'import')?.detail).toBe('CNTR · BRSSZ-BRVIX · Manifesto Mercante CE-123')
    expect(events.find((e) => e.kind === 'ce-coverage')?.detail).toBe('2/2 B/Ls com CE')
  })

  // O autor do import não vem de `audit_logs` como o das demais fontes: o batch
  // guarda `uploaded_by` e o departamento é resolvido à parte. O par chegava a
  // `buildVoyageTimeline` e era descartado, então a viagem creditava toda
  // mudança de escala e deixava anônimo o evento que originou os dados.
  it('credita quem importou o manifesto, com departamento', () => {
    const [evento] = buildVoyageTimeline({
      importBatches: [{ id: 1, filename: 'manifesto.edi', cargo_mode: 'container', uploaded_at: '2026-06-01T10:00:00Z', route: 'BRSSZ-BRVIX', uploaded_by: 'u-1' }],
      actorNames: { 'u-1': 'Ana Lima' },
      actorDepartments: { 'u-1': 'Documentação' },
    })
    expect(evento.detail).toBe('CNTR · BRSSZ-BRVIX · por Ana Lima (Documentação)')
  })

  it('um evento por lote, com cada rota no detalhe, quando o manifesto cobre mais de uma', () => {
    const events = buildVoyageTimeline({
      importBatches: [{
        id: 1, filename: 'manifesto.edi', cargo_mode: 'carga_solta', uploaded_at: '2026-06-01T10:00:00Z', uploaded_by: 'u-1',
        routes: [{ pol: 'BRSSZ', pod: 'BRVIX', blCount: 2 }, { pol: 'BRSSZ', pod: 'BRRIO', blCount: 1 }],
      }],
      actorNames: { 'u-1': 'Ana Lima' },
      actorDepartments: { 'u-1': 'Documentação' },
    })
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('3 B/Ls importados · 2 rotas')
    expect(events[0].detail).toBe('BB · BRSSZ → BRVIX: 2 · BRSSZ → BRRIO: 1 · por Ana Lima (Documentação)')
  })

  // Sem nome resolvido o UUID não vira texto de tela, e sem departamento o
  // crédito não inventa um.
  it('omite o crédito do import quando o autor não é identificável', () => {
    const semAutor = buildVoyageTimeline({
      importBatches: [{ id: 1, filename: 'x.edi', cargo_mode: 'container', uploaded_at: '2026-06-01T10:00:00Z' }],
    })
    expect(semAutor[0].detail).toBe('CNTR · x')

    const semDepartamento = buildVoyageTimeline({
      importBatches: [{ id: 1, filename: 'x.edi', cargo_mode: 'container', uploaded_at: '2026-06-01T10:00:00Z', uploaded_by: 'u-1' }],
      actorNames: { 'u-1': 'Ana Lima' },
    })
    expect(semDepartamento[0].detail).toBe('CNTR · x · por Ana Lima')
  })

  it('ignora lotes sem data de upload e retorna lista vazia sem fontes', () => {
    expect(buildVoyageTimeline({ importBatches: [{ id: 9, filename: 'x', cargo_mode: 'container', uploaded_at: null }] })).toEqual([])
    expect(buildVoyageTimeline({})).toEqual([])
  })
})
