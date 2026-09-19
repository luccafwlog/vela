// @vitest-environment jsdom

import { cleanup, fireEvent, render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VoyageAgencyReportTab } from '../VoyageAgencyReportTab'
import { ToastProvider } from '../../ui/Toast'
import { formatBRL } from '../../../lib/utils'

// O componente usa `useToast`, que exige `ToastProvider` (o app o monta em
// `main.tsx`). Envolver aqui, num render único, mantém as chamadas de teste
// inalteradas em vez de repetir o provider em cada uma delas.
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: ToastProvider })

const { useAgencyReportDerivedMock, useAgencyReportOwnMock, useAgencyReportTerminalStateMock, terminalMutateMock, closeMutateMock, reopenMutateMock, useAuthMock } = vi.hoisted(() => ({
  useAgencyReportDerivedMock: vi.fn(),
  useAgencyReportOwnMock: vi.fn(),
  useAgencyReportTerminalStateMock: vi.fn(),
  terminalMutateMock: vi.fn(),
  closeMutateMock: vi.fn(),
  reopenMutateMock: vi.fn(),
  useAuthMock: vi.fn(),
}))

const { signoffMutateMock, departmentSignoffMutateMock, observationMutateMock, useAgencyReportSignoffEventsMock, useAgencyReportDepartmentSignoffEventsMock } = vi.hoisted(() => ({
  signoffMutateMock: vi.fn(),
  departmentSignoffMutateMock: vi.fn(),
  observationMutateMock: vi.fn(),
  useAgencyReportSignoffEventsMock: vi.fn(),
  useAgencyReportDepartmentSignoffEventsMock: vi.fn(),
}))

vi.mock('../../../hooks/useAgencyReport', () => ({
  useAgencyReportDerived: useAgencyReportDerivedMock,
  useAgencyReportOwn: useAgencyReportOwnMock,
  useAgencyReportTerminalState: useAgencyReportTerminalStateMock,
  useAgencyReportSignoffEvents: useAgencyReportSignoffEventsMock,
  useAgencyReportDepartmentSignoffEvents: useAgencyReportDepartmentSignoffEventsMock,
  useSetAgencyReportSignoff: () => ({ mutate: signoffMutateMock, isPending: false }),
  useSetAgencyReportDepartmentSignoff: () => ({ mutate: departmentSignoffMutateMock, isPending: false }),
  useSetAgencyReportSectionObservation: () => ({ mutate: observationMutateMock }),
  useSetAgencyReportTerminal: () => ({ mutate: terminalMutateMock, isPending: false }),
  useCloseAgencyReport: () => ({ mutate: closeMutateMock, isPending: false }),
  useReopenAgencyReport: () => ({ mutate: reopenMutateMock, isPending: false }),
}))
vi.mock('../../../hooks/useAuth', () => ({ useAuth: useAuthMock }))

const ALL_SECTIONS = [
  'datas', 'carga_descarregada', 'carga_carregada', 'veiculos',
  'vazios_embarcados', 'vazios_descarregados',
]

function allSectionsSignoffs(state = 'confirmed') {
  return ALL_SECTIONS.map((section) => ({ id: section, section, state }))
}

function allDepartmentsSigned() {
  return [
    { id: 'ds-1', department: 'operacoes', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
    { id: 'ds-2', department: 'documentacao', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
    { id: 'ds-3', department: 'equipamentos', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' },
  ]
}

beforeEach(() => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: undefined })
  useAgencyReportTerminalStateMock.mockReturnValue({ data: { agencyReports: [] }, isLoading: false, error: null })
  useAgencyReportSignoffEventsMock.mockReturnValue({ data: [] })
  useAgencyReportDepartmentSignoffEventsMock.mockReturnValue({ data: [] })
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
})

afterEach(cleanup)

it('abre a escala indicada no deep-link e permite trocar a escala do ADR', () => {
  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRRIO', omitted: false }]}
      initialEscala="BRRIO"
    />,
  )

  expect(screen.getByRole('button', { name: 'BRRIO' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'BRVIX' }))
  expect(screen.getByRole('button', { name: 'BRVIX' }).getAttribute('aria-pressed')).toBe('true')
})

it('exibe unidades sem armazenagem na subseção Operação de pátio', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [],
      vaziosExp: [
        { container_type: '40HC', local_id: 'tvv', condition: 'vazio', local: { id: 'tvv', code: 'TVV', name: 'TVV', tipo: 'terminal_portuario' } },
        { container_type: '40HC', local_id: 'd1', condition: 'vazio', local: { id: 'd1', code: 'VBR', name: 'VBR', tipo: 'depot' } },
      ],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  const patioSection = screen.getByRole('heading', { name: /Opera.*o de p.*tio/, level: 4 }).closest('section')!
  expect(within(patioSection).getByText('Unidades sem armazenagem')).toBeTruthy()
})

it('exibe a linha de serviço pelo nome, nao pelo id', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: { containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 }, operation: {}, costs: { total: 3, serviceLines: [{ id: 'l1', service: { name: 'Bundle Composition' }, local: { name: 'VBR' }, destino: null, local_id: 'd1', service_id: 's1', container_type: null, quantidade: 3, percentual: 100, valor_unitario: 1, total: 3 }] } },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.getByText('Bundle Composition')).toBeTruthy()
  const serviceTable = screen.getByText('Bundle Composition').closest('table')!
  expect(within(serviceTable).queryByRole('columnheader', { name: '%' })).toBeNull()
  expect(within(serviceTable).queryByText('100')).toBeNull()
})

it('mantém o cabeçalho da escala e exibe granito no ADR terminalizado', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: {
      agencyReports: [{
        reportId: 'report-portmac', voyageId: 7, port: 'BRVIX', terminalId: 'portmac', terminalCode: 'PORTMAC', terminal: 'Porto Macuco', status: 'open',
        sections: [
          { section: 'datas', state: 'nothing_operated', fronts: [] },
          { section: 'carga_carregada', state: 'operated', fronts: ['granito'] },
        ],
      }],
    },
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { status: 'open', terminal: 'Porto Macuco', signoffs: [], departmentSignoffs: [], occurrences: [], actor_names: {} } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [{ real_weight_kg: 25_000, blocks_qty: 25 }], vaziosExp: [],
      storage: { containers: 0, days: 0 }, operation: {}, schedule: { ata: '2026-08-18', atb: '2026-08-18', atd: null, rtw: 0 }, unifiedAtd: { atd: null, atdSource: null, atdRegisteredAt: null },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} reportId="report-portmac" terminalCode="PORTMAC" />)

  expect(screen.getByText('Armador teste')).toBeTruthy()
  expect(screen.getAllByText(/PORTMAC/).length).toBeGreaterThan(0)
  expect(screen.getAllByText('25').length).toBeGreaterThan(0)
})

it('não congela vazios de exportação no ADR que só recebeu vazio de importação', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: {
      agencyReports: [{
        reportId: 'report-tvv', voyageId: 7, port: 'BRVIX', terminalId: 'tvv', terminalCode: 'TVV', terminal: 'TVV', status: 'open',
        sections: [
          { section: 'vazios_descarregados', state: 'operated', fronts: ['vazio'], frontKeys: ['importacao:vazio'] },
          { section: 'vazios_embarcados', state: 'nothing_operated', fronts: [], frontKeys: [] },
        ],
      }],
    },
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { status: 'open', terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [], actor_names: {} } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [{ container_type: '20DV' }], granite: [],
      vaziosExp: [{ container_type: '40HC', local: { code: 'PORTMAC', tipo: 'terminal_portuario' } }],
      storage: { containers: 2, days: 3 }, operation: { os_number: 'OS-1' }, costs: { serviceLines: [{ id: 'line-1' }] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} reportId="report-tvv" terminalCode="TVV" />)
  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))

  const snapshot = closeMutateMock.mock.calls.at(-1)?.[0]?.snapshot
  expect(snapshot.sections).toMatchObject({
    vaziosDescarregados: expect.objectContaining({ totals: expect.any(Object) }),
    vaziosEmbarcados: [],
    vaziosUnidades: [],
    depots: [],
    directEmbarkCount: 0,
    storage: null,
    operation: null,
    costs: null,
  })
})

it('mantém ADR legado fora das RPCs terminalizadas quando há deep-link legado', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: {
      agencyReports: [
        {
          reportId: 'legacy-report', voyageId: 7, port: 'BRVIX', terminalId: null, terminalCode: null, terminal: null, status: 'open',
          sections: [{ section: 'datas', state: 'nothing_operated', fronts: [], frontKeys: [] }],
        },
        {
          reportId: 'report-tvv', voyageId: 7, port: 'BRVIX', terminalId: 'tvv', terminalCode: 'TVV', terminal: 'TVV', status: 'open',
          sections: [{ section: 'datas', state: 'nothing_operated', fronts: [], frontKeys: [] }],
        },
      ],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} reportId="legacy-report" />)

  expect(useAgencyReportOwnMock.mock.calls.at(-1)?.[2]).toBeNull()
})

it('mantém o terminal editável no ADR legado sem frente atribuída', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: {
      agencyReports: [{
        reportId: 'legacy-report', voyageId: 7, port: 'BRVIX', terminalId: null, terminalCode: null, terminal: null, status: 'open',
        sections: [{ section: 'datas', state: 'nothing_operated', fronts: [], frontKeys: [] }],
      }],
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { id: 'legacy-report', status: 'open', terminal: null, signoffs: [], departmentSignoffs: [], occurrences: [], actor_names: {} } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} reportId="legacy-report" />)

  const terminalInput = screen.getByLabelText('Terminal') as HTMLInputElement
  fireEvent.change(terminalInput, { target: { value: 'TVV' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

  expect(terminalMutateMock).toHaveBeenCalledWith(expect.objectContaining({ voyageId: 7, port: 'BRVIX', terminal: 'TVV' }), expect.any(Object))
})

it('mantém o Terminal legado somente leitura fora de operações e administração', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: {
      agencyReports: [{
        reportId: 'legacy-report', voyageId: 7, port: 'BRVIX', terminalId: null, terminalCode: null, terminal: null, status: 'open',
        sections: [{ section: 'datas', state: 'nothing_operated', fronts: [], frontKeys: [] }],
      }],
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { id: 'legacy-report', status: 'open', terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [], actor_names: {} } })
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} reportId="legacy-report" />)

  expect(screen.queryByLabelText('Terminal')).toBeNull()
  expect(screen.getByText('TVV')).toBeTruthy()
})

it('não habilita ADR legado enquanto o estado terminalizado está carregando ou falhou', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
  const { rerender } = render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.getByText(/Carregando frentes, terminais e ADRs/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Salvar' })).toBeNull()

  useAgencyReportTerminalStateMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('indisponivel') })
  rerender(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.getByText(/Nenhuma ação foi habilitada/)).toBeTruthy()
})

it('a soma das linhas exibidas bate com o "Total da operação" para uma linha legada de armazenagem com percentual não nulo', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 }, operation: {},
      costs: {
        total: 1000,
        serviceLines: [{
          id: 'l1', service: { name: 'Armazenagem' }, local: { name: 'VBR' }, destino: null, local_id: 'd1', service_id: 's1',
          container_type: null, quantidade: 10, percentual: 50, valor_unitario: 100, total: 1000,
        }],
      },
    },
    isLoading: false,
    error: null,
  })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  const patioSection = screen.getByRole('heading', { name: /Opera.*o de p.*tio/, level: 4 }).closest('section')!
  // O total da linha (lido de service.total, calculado por totalLinha) e o
  // "Total da operação" precisam bater — antes da Task 8, a fórmula inline da
  // linha aplicava o percentual legado (50%) e mostrava R$ 500,00. Compara via
  // textContent (sem normalização de espaço) para não depender do NBSP que
  // formatBRL usa entre "R$" e o valor.
  const occurrences = patioSection.textContent!.split(formatBRL(1000)).length - 1
  expect(occurrences).toBe(2)
})

it('exibe a barra-resumo dos 3 departamentos e o sign-off da seção do usuário', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed', signed_by: 'user-1', signed_at: '2026-07-19T12:00:00Z' }],
      departmentSignoffs: [],
      occurrences: [{ id: 'occ-1', body: 'Atracação concluída.', department: 'operacoes', author_id: 'user-1', created_at: '2026-07-19T10:00:00Z', section: null }],
      actor_names: { 'user-1': 'Ana Ribeiro' },
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('0/3 departamentos assinados')).toBeTruthy()
  expect(screen.getByText('Operações')).toBeTruthy()
  expect(screen.getByText('Documentação')).toBeTruthy()
  expect(screen.getByText('Equipamentos')).toBeTruthy()
  expect(screen.getByText(/Confirmado por Ana Ribeiro em 19\/07\/2026/)).toBeTruthy()
})

it('assina o departamento apenas quando habilitado e chama a RPC com o payload correto', () => {
  departmentSignoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: ['veiculos', 'carga_carregada', 'vazios_embarcados'].map((section) => ({ id: section, section, state: 'confirmed' })),
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const equipamentosCard = screen.getByText('Equipamentos').closest('div.app-panel')! as HTMLElement
  const signButton = within(equipamentosCard).getByRole('button', { name: 'Assinar' })
  expect((signButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(signButton)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(departmentSignoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', department: 'equipamentos', signed: true, justification: undefined,
  })
})

it('desabilita assinar o departamento enquanto houver seção pendente', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'veiculos', section: 'veiculos', state: 'confirmed' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const equipamentosCard = screen.getByText('Equipamentos').closest('div.app-panel')! as HTMLElement
  const signButton = within(equipamentosCard).getByRole('button', { name: 'Assinar' }) as HTMLButtonElement
  expect(signButton.disabled).toBe(true)
})

it('reabrir um sign-off departamental exige justificativa', () => {
  departmentSignoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: [{ id: 'ds-1', department: 'operacoes', signed_by: 'user-1', signed_at: '2026-07-20T09:00:00Z' }],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const operacoesCard = screen.getByText('Operações').closest('div.app-panel')! as HTMLElement
  fireEvent.click(within(operacoesCard).getByRole('button', { name: 'Reabrir' }))
  const confirm = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Justificativa'), { target: { value: 'Correção necessária' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)

  expect(departmentSignoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', department: 'operacoes', signed: false, justification: 'Correção necessária',
  })
})

it('fecha o ADR apenas quando os 3 departamentos assinaram e envia o snapshot exibido', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: allDepartmentsSigned(),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('3/3 departamentos assinados')).toBeTruthy()
  const closeButton = screen.getByRole('button', { name: 'Fechar ADR' })
  expect((closeButton as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(closeButton)
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    voyageId: 7,
    port: 'BRVIX',
    snapshot: expect.objectContaining({ sections: expect.any(Object) }),
  }),
  expect.objectContaining({ onError: expect.any(Function) }))
})

// ADR 0039, Task 4: os marcos do Prazo de Conclusão (ATD unificado, sua
// fonte/registro e o prazo calculado) e as reaberturas por departamento
// precisam sair congelados no snapshot de fechamento — Task 5 (relatório de
// SLA) depende deles para não reconsultar audit_logs.
it('congela o ATD unificado, o prazo calculado e as reaberturas departamentais no snapshot de fechamento', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: { agencyReports: [{ reportId: 'report-tvv', voyageId: 7, port: 'BRVIX', terminalId: 'tvv', terminalCode: 'TVV', terminal: 'TVV', status: 'open', sections: ALL_SECTIONS.map((section) => ({ section, state: 'operated', fronts: [], frontKeys: ['importacao:vazio'] })) }] },
    isLoading: false,
    error: null,
  })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [],
      storage: { containers: 0, days: 0 }, operation: {},
      escala: { ata: null },
      terminalSchedules: [{ terminalId: 'tvv', terminalCode: 'TVV', atb: '2026-07-19', atd: '2026-07-20', rtw: 2 }],
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: allDepartmentsSigned(),
      occurrences: [],
    },
  })
  useAgencyReportDepartmentSignoffEventsMock.mockReturnValue({
    data: [
      { id: 1, department: 'operacoes', old_value: 'true', new_value: 'false', justification: 'Correção necessária', changed_by: 'user-1', changed_at: '2026-07-21T10:00:00Z' },
      { id: 2, department: 'operacoes', old_value: 'false', new_value: 'true', justification: null, changed_by: 'user-1', changed_at: '2026-07-21T11:00:00Z' },
    ],
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      header: expect.objectContaining({
        unifiedAtd: '2026-07-20',
        atdSource: 'terminal',
        atdRegisteredAt: null,
        deadlineDate: expect.any(String),
      }),
      departmentSignoffs: expect.arrayContaining([
        expect.objectContaining({
          department: 'operacoes',
          reopenings: [
            { changed_at: '2026-07-21T10:00:00Z', changed_by: 'user-1', justification: 'Correção necessária' },
          ],
        }),
        expect.objectContaining({ department: 'documentacao', reopenings: [] }),
      ]),
    }),
  }), expect.anything())

  // Mock de módulo persiste entre `it`s — devolve ao default para não vazar
  // reaberturas para os testes seguintes.
  useAgencyReportDepartmentSignoffEventsMock.mockReturnValue({ data: [] })
})

it('mantém Fechar ADR desabilitado enquanto faltar algum departamento', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: allSectionsSignoffs(),
      departmentSignoffs: allDepartmentsSigned().slice(0, 2),
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText('2/3 departamentos assinados')).toBeTruthy()
  const closeButton = screen.getByRole('button', { name: 'Fechar ADR' }) as HTMLButtonElement
  expect(closeButton.disabled).toBe(true)
})

it('exibe a carga solta derivada e a congela sob cargaSolta no snapshot', () => {
  const cargaSolta = { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 }
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta,
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getAllByText('Máquinas')).toHaveLength(2)
  expect(screen.getByText('3')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      sections: expect.objectContaining({ cargaSolta }),
    }),
  }),
  expect.objectContaining({ onError: expect.any(Function) }))
})

it('agrupa carga solta na seção de carga descarregada e assina granito como carga carregada', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      cargaSolta: { bls: 2, machines: 3, packages: 12, weightTon: 6, cbm: 20 },
      containers: [], vehicles: [], vaziosImp: [],
      granite: [{ blocks_qty: 5, real_weight_kg: 8_000 }],
      vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [
        { id: 'unload', section: 'carga_descarregada', state: 'confirmed' },
        { id: 'load', section: 'carga_carregada', state: 'nothing_to_declare' },
      ],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')
  const graniteSection = screen.getByRole('heading', { name: 'Carga carregada' }).closest('section')

  expect(dischargeSection).not.toBeNull()
  expect(graniteSection).not.toBeNull()
  expect(within(dischargeSection!).getByText('Carga solta')).toBeTruthy()
  expect(within(dischargeSection!).getByText('Confirmado')).toBeTruthy()
  expect(within(graniteSection!).getByText('Nada a declarar')).toBeTruthy()
  expect(within(graniteSection!).getByText('Nada a declarar')).toBeTruthy()
})

it('destaca o IMO separado da contagem geral de containers descarregados', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [
        { size_type: '40HC', is_imo: false }, { size_type: '40HC', is_imo: true }, { size_type: '20GP', is_imo: false },
      ],
      vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  const containersCard = within(dischargeSection).getByText('Containers descarregados').closest('div') as HTMLElement
  expect(within(containersCard).getByText('3')).toBeTruthy()
  const imoToken = within(dischargeSection).getByText('IMO', { selector: 'span.font-semibold' }).closest('span.app-voyage-token') as HTMLElement
  expect(within(imoToken).getByText('1')).toBeTruthy()
  expect(within(dischargeSection).getByText('Por tipo e natureza')).toBeTruthy()
})

it('renomeia Container com veículo para Veículos', () => {
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      vehicles: [{ brand: 'BYD', bl_id: 'bl-1', chassis: 'vin-1', container: { unpacking_location: 'Pátio Alfa' } }],
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('heading', { name: 'Veículos' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Container com veículo' })).toBeNull()
})

it('agrupa as seções por departamento e mantém a Escala como subseção de Operações', () => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('heading', { name: 'Operações', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Documentação', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Equipamentos', level: 2 })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Escala', level: 3 })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Escala', level: 2 })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Importação', level: 2 })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Exportação', level: 2 })).toBeNull()
})

it('Exportação reúne Granito e Embarque de vazios, com pátio como subseção; nenhuma seção mostra legenda-resumo', () => {
  useAgencyReportDerivedMock.mockReturnValue({ data: undefined, isLoading: false, error: null })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const equipamentosGroup = screen.getByRole('heading', { name: 'Equipamentos', level: 2 }).closest('div.app-panel') as HTMLElement
  expect(within(equipamentosGroup).getByRole('heading', { name: 'Carga carregada' })).toBeTruthy()
  // Embarque de Vazios é um agregado só (CONTEXT.md): uma seção assinável, com
  // as unidades e os serviços como subseções de conteúdo.
  const embarqueSection = within(equipamentosGroup).getByRole('heading', { name: 'Embarque de vazios' }).closest('section') as HTMLElement
  expect(within(embarqueSection).getByRole('heading', { name: 'Containers embarcados', level: 4 })).toBeTruthy()
  expect(within(embarqueSection).getByRole('heading', { name: 'Operação de pátio', level: 4 })).toBeTruthy()

  for (const legend of [
    'Janela operacional da escala; dados confirmados por Operações.',
    'Storage, overtime, depots e serviços extra dos vazios de exportação — base da conferência de faturas de armazenagem e overtime pelo Financeiro.',
    'Containers vazios embarcados nesta escala, por tipo.',
  ]) {
    expect(screen.queryByText(legend)).toBeNull()
  }
})

it('congela locais de desova, depots e embarques diretos no snapshot', () => {
  useAgencyReportTerminalStateMock.mockReturnValue({
    data: { agencyReports: [{ reportId: 'report-tvv', voyageId: 7, port: 'BRVIX', terminalId: 'tvv', terminalCode: 'TVV', terminal: 'TVV', status: 'open', sections: ALL_SECTIONS.map((section) => ({ section, state: 'operated', fronts: [], frontKeys: ['importacao:vazio'] })) }] },
    isLoading: false,
    error: null,
  })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      escala: { ata: '2026-07-19' },
      terminalSchedules: [{ terminalId: 'tvv', terminalCode: 'TVV', atb: '2026-07-19', atd: '2026-07-20', rtw: 2 }],
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 },
      containers: [], vaziosImp: [], granite: [], storage: { containers: 1, days: 2 },
      vehicles: [{ brand: 'BYD', bl_id: 'bl-1', chassis: 'vin-1', container: { unpacking_location: 'Pátio Alfa' } }],
      vaziosExp: [
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'tvv', condition: 'vazio', local: { id: 'tvv', code: 'TVV', name: 'TVV', tipo: 'terminal_portuario' } },
      ],
      operation: { os_number: 'OS-42', service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: allSectionsSignoffs(), departmentSignoffs: allDepartmentsSigned(), occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  fireEvent.click(screen.getByRole('button', { name: 'Fechar ADR' }))
  expect(closeMutateMock).toHaveBeenCalledWith(expect.objectContaining({
    snapshot: expect.objectContaining({
      header: expect.objectContaining({ schedule: expect.objectContaining({ atb: '2026-07-19', rtw: 2 }) }),
      sections: expect.objectContaining({
        vehicleLocations: { BYD: ['Pátio Alfa'] },
        directEmbarkCount: 1,
        depots: ['VBR'],
      }),
    }),
  }),
  expect.objectContaining({ onError: expect.any(Function) }))
})

it('exibe o autor resolvido e o documento estruturado quando o ADR está fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: {
        header: { schedule: {} },
        sections: { cargaDescarregada: { rows: { '40HC': { carga_geral: 1 } }, totals: { carga_geral: 1 } } },
      },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByRole('status').textContent).toContain('Fechado em')
  expect(screen.getByRole('status').textContent).toContain('Lucca F.')
  // O documento estruturado vive apenas no modal de impressão desde
  // `Show ADR document only in print modal`; a aba fechada não o renderiza inline.
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
  expect(screen.getByRole('table', { name: 'Matriz de descarga' })).toBeTruthy()
})

it('no estado fechado renderiza o documento e oculta controles/seções editáveis', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.queryByRole('heading', { name: 'Matriz de descarga' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Fechar ADR' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  const printButton = screen.getByRole('button', { name: 'Imprimir' })
  expect(printButton).toBeTruthy()
  fireEvent.click(printButton)
  // A matriz deste snapshot esta vazia e a resolucao da seção ja saiu em
  // "Carga solta": a faixa "Matriz de descarga" nao e impressa. O que prova
  // que o documento abriu e o proprio documento.
  expect(screen.getByRole('article', { name: 'Agency Departure Report fechado' })).toBeTruthy()
})

it('exibe Reabrir do ADR somente para administradores e exige justificativa não vazia', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'administrativo', isAdmin: true })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [], departmentSignoffs: [], occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
  const confirm = screen.getByRole('button', { name: 'Confirmar reabertura' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
  expect(confirm.disabled).toBe(true)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Correção necessária' } })
  expect(confirm.disabled).toBe(false)
  fireEvent.click(confirm)
  expect(reopenMutateMock).toHaveBeenCalledWith({ voyageId: 7, port: 'BRVIX', justification: 'Correção necessária' }, expect.any(Object))
})

it('não exibe Reabrir do ADR para usuário não administrador', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_snapshot: { header: { schedule: {} }, sections: { cargaDescarregada: { rows: {}, totals: {} } }, occurrences: [], signoffs: [] },
      signoffs: [], departmentSignoffs: [], occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)
  expect(screen.queryByRole('button', { name: 'Reabrir' })).toBeNull()
})

it('a primeira saída de Pendente só pede confirmação, sem justificativa', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Alterar resolução de Operações' }))
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Confirmado' }))

  expect(screen.queryByLabelText('Justificativa')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))

  expect(signoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'datas', state: 'confirmed', justification: undefined,
  })
})

it('alterar uma decisão já registrada exige justificativa não vazia', () => {
  signoffMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: { terminal: 'TVV', signoffs: [{ id: 'so-1', section: 'datas', state: 'confirmed' }], departmentSignoffs: [], occurrences: [] },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Alterar resolução de Operações' }))
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Nada a declarar' }))

  const justificationField = screen.getByLabelText('Justificativa')
  const confirmButton = screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement
  expect(confirmButton.disabled).toBe(true)

  fireEvent.change(justificationField, { target: { value: '  ' } })
  expect(confirmButton.disabled).toBe(true)

  fireEvent.change(justificationField, { target: { value: 'Correção após revisão' } })
  expect(confirmButton.disabled).toBe(false)
  fireEvent.click(confirmButton)

  expect(signoffMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'datas', state: 'nothing_to_declare', justification: 'Correção após revisão',
  })
})

it('sem eventos, não exibe o ícone de histórico', () => {
  useAgencyReportSignoffEventsMock.mockReturnValue({ data: [] })
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  expect(within(datasSection).queryByTitle('Ver histórico')).toBeNull()
})

it('com eventos, o histórico lista de→para, autor e justificativa', () => {
  useAgencyReportSignoffEventsMock.mockReturnValue({
    data: [{
      id: 1,
      section: 'datas',
      old_value: 'confirmed',
      new_value: 'nothing_to_declare',
      justification: 'Correção após revisão',
      changed_by: 'user-1',
      changed_at: '2026-07-20T10:00:00Z',
    }],
  })
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'so-1', section: 'datas', state: 'nothing_to_declare' }],
      departmentSignoffs: [],
      occurrences: [],
      actor_names: { 'user-1': 'Ana Ribeiro' },
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  fireEvent.click(within(datasSection).getByTitle('Ver histórico'))

  expect(screen.getByText('Confirmado → Nada a declarar')).toBeTruthy()
  expect(screen.getByText(/Ana Ribeiro/)).toBeTruthy()
  expect(screen.getByText('Correção após revisão')).toBeTruthy()
})

it('mostra o campo de Observação em cada seção, editável só pelo dono', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [
        { id: 'veiculos', section: 'veiculos', state: 'pending', observation: 'Container avariado no pátio.' },
        { id: 'datas', section: 'datas', state: 'pending', observation: null },
      ],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  // Dono da seção (Equipamentos → veículos): campo editável, valor preenchido.
  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  fireEvent.click(within(veiculosSection).getByRole('button', { name: 'Editar observação' }))
  const veiculosObservation = within(veiculosSection).getByLabelText('Observação — Veículos') as HTMLTextAreaElement
  expect(veiculosObservation.tagName).toBe('TEXTAREA')
  expect(veiculosObservation.value).toBe('Container avariado no pátio.')

  // Seção de outro departamento (Operações → datas) e sem observação escrita:
  // nada é exibido — nem campo, nem o "—" que anunciava uma nota inexistente.
  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  expect(within(datasSection).queryByLabelText('Observação — Escala')).toBeNull()
  expect(within(datasSection).queryByText('Observação')).toBeNull()
  expect(within(datasSection).queryByRole('button', { name: 'Adicionar observação' })).toBeNull()
})

it('sem observação escrita, só o dono vê o convite para adicionar uma', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'datas', section: 'datas', state: 'pending', observation: null }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  const invite = within(datasSection).getByRole('button', { name: 'Adicionar observação' })
  expect(within(datasSection).queryByLabelText('Observação — Escala')).toBeNull()

  fireEvent.click(invite)
  expect(screen.getByRole('dialog', { name: 'Adicionar observação — Escala' })).toBeTruthy()
  expect(screen.getByLabelText('Observação — Escala')).toBeTruthy()
})

it('observação escrita por outro departamento é lida por quem não pode editá-la', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'veiculos', section: 'veiculos', state: 'pending', observation: 'Container avariado no pátio.' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  expect(within(veiculosSection).getByText('Container avariado no pátio.')).toBeTruthy()
  expect(within(veiculosSection).queryByLabelText('Observação — Veículos')).toBeNull()
})

it('sobrescrever a Observação não pede justificativa e chama a RPC de Observação', () => {
  observationMutateMock.mockClear()
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'veiculos', section: 'veiculos', state: 'confirmed', observation: 'Nota antiga' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  fireEvent.click(within(veiculosSection).getByRole('button', { name: 'Editar observação' }))
  const observationField = within(veiculosSection).getByLabelText('Observação — Veículos')
  fireEvent.change(observationField, { target: { value: 'Nota atualizada' } })
  fireEvent.click(within(veiculosSection).getByRole('button', { name: 'Salvar alterações' }))

  expect(screen.queryByLabelText('Justificativa')).toBeNull()
  expect(observationMutateMock).toHaveBeenCalledWith({
    voyageId: 7, port: 'BRVIX', section: 'veiculos', observation: 'Nota atualizada',
  })
})

it('sign-off de Operações não é mais bloqueado por Ocorrências (1 seção: datas)', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      terminal: 'TVV',
      signoffs: [{ id: 'datas', section: 'datas', state: 'confirmed' }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const operacoesCard = screen.getByText('Operações').closest('div.app-panel')! as HTMLElement
  const signButton = within(operacoesCard).getByRole('button', { name: 'Assinar' }) as HTMLButtonElement
  expect(signButton.disabled).toBe(false)
})

it('marca com o chip "Omitida" a escala omitida que só entrou na lista por ter ADR fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: undefined })
  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRSSA', omitted: true }]}
    />,
  )

  const activeButton = screen.getByRole('button', { name: 'BRVIX' })
  expect(within(activeButton).queryByText('Omitida')).toBeNull()

  const omittedButton = screen.getByRole('button', { name: /BRSSA/ })
  expect(within(omittedButton).getByText('Omitida')).toBeTruthy()
})

it('escala omitida com ADR fechado continua acessível: abre pelo deep-link e renderiza o snapshot fechado', () => {
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      status: 'closed',
      closed_at: '2026-07-20T10:00:00Z',
      closed_by_name: 'Lucca F.',
      closed_snapshot: {
        header: { schedule: {} },
        sections: { cargaDescarregada: { rows: { '40HC': { carga_geral: 1 } }, totals: { carga_geral: 1 } } },
      },
      signoffs: [],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(
    <VoyageAgencyReportTab
      voyageId={7}
      voyageLabel="NAVIO TESTE / 01E"
      carrierName="Armador teste"
      pods={[{ pod: 'BRVIX', omitted: false }, { pod: 'BRSSA', omitted: true }]}
      initialEscala="BRSSA"
    />,
  )

  expect(screen.getByRole('button', { name: /BRSSA/ }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('status').textContent).toContain('Fechado em')
  // Idem: o snapshot fechado é renderizado dentro do modal de impressão.
  fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
  expect(screen.getByRole('table', { name: 'Matriz de descarga' })).toBeTruthy()
})

// Task 4 do ADR 2026-07-31: a listagem do operado substitui a matriz com
// zeros. As três verificações pedidas pelo plano seguem abaixo.

it('escala sem carga solta não renderiza o bloco "Carga solta" nem a seção inteira quando também não há containers', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      // sem cargaSolta.bls: não há carga solta nesta escala
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).queryByText('Carga solta')).toBeNull()
  expect(within(dischargeSection).getByText('Nada operado nesta escala.')).toBeTruthy()
})

it('carga solta só em transbordo (sem carga própria) aparece na seção em vez de "Nada operado" (Task 1 do ADR 2026-07-31)', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      cargaSolta: {
        bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0,
        transshipment: { bls: 2, machines: 3, packages: 10, weightTon: 15, cbm: 25 },
      },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).queryByText('Nada operado nesta escala.')).toBeNull()
  expect(within(dischargeSection).getByText('Carga solta')).toBeTruthy()
  expect(within(dischargeSection).getByText('Em transbordo')).toBeTruthy()
  expect(within(dischargeSection).getAllByText('2').length).toBeGreaterThan(0)
})

it('marca com "em transbordo" o VIN de um veículo que chegou por transbordo (Task 1 do ADR 2026-07-31)', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vaziosImp: [], granite: [], vaziosExp: [],
      storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      cargaSolta: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0, transshipment: { bls: 0, machines: 0, packages: 0, weightTon: 0, cbm: 0 } },
      vehicles: [
        { brand: 'BYD', bl_id: 'a', chassis: '1', container_id: null, container: null, isTransshipment: false },
        { brand: 'BYD', bl_id: 'b', chassis: '2', container_id: null, container: null, isTransshipment: true },
      ],
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText((_, node) => node?.textContent === '2 BLs · 2 VINs · 1 em transbordo · local de desova não informado')).toBeTruthy()
})

it('combinação inexistente não vira linha na listagem do operado — só o que ocorreu aparece', () => {
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [
        { size_type: '40HC', is_imo: false, category: 'carga_geral' },
        { size_type: '40HC', is_imo: false, category: 'carga_geral' },
      ],
      vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).getAllByText('40HC').length).toBeGreaterThan(0)
  expect(within(dischargeSection).getByText('Carga geral')).toBeTruthy()
  expect(within(dischargeSection).queryByText(/20GP/)).toBeNull()
  expect(within(dischargeSection).getByText('IMO')).toBeTruthy()
  expect(within(dischargeSection).queryByText(/veículos/i)).toBeNull()
})

it('seção vazia continua Pendente com o controle de resolução visível', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const dischargeSection = screen.getByRole('heading', { name: 'Carga descarregada' }).closest('section')!
  expect(within(dischargeSection).getByText('Nada operado nesta escala.')).toBeTruthy()
  expect(within(dischargeSection).getByText('Pendente')).toBeTruthy()
  fireEvent.click(within(dischargeSection).getByRole('button', { name: 'Alterar resolução de Documentação' }))
  expect(within(dischargeSection).getByRole('button', { name: 'Confirmado' })).toBeTruthy()
  expect(within(dischargeSection).getByRole('button', { name: 'Nada a declarar' })).toBeTruthy()
})

it('veículos sem VIN e vazios embarcados sem booking somem, mostrando "nada operado nesta escala"', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const veiculosSection = screen.getByRole('heading', { name: 'Veículos' }).closest('section')!
  expect(within(veiculosSection).getByText('Nada operado nesta escala.')).toBeTruthy()

  // Embarque de vazios tem duas subseções, e cada uma diz o que faltou nela:
  // um "Nada operado" só no topo esconderia qual das duas está vazia.
  const embarqueSection = screen.getByRole('heading', { name: 'Embarque de vazios' }).closest('section')!
  expect(within(embarqueSection).getByText('Nenhum vazio embarcado nesta escala.')).toBeTruthy()
  expect(within(embarqueSection).getByText('Nenhum serviço de pátio nesta escala.')).toBeTruthy()
})

it('mostra o total de vazios embarcados por tipo e, lado a lado, uma mini-seção por depot/terminal com o total por tipo', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      vaziosExp: [
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'vbr', condition: 'vazio', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '40HC', local_id: 'vbr', condition: 'material', local: { id: 'vbr', code: 'VBR', name: 'VBR', tipo: 'depot' } },
        { container_type: '20GP', local_id: 'tvv', condition: 'vazio', local: { id: 'tvv', code: 'TVV', name: 'TVV', tipo: 'terminal_portuario' } },
      ],
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const containersEmbarcados = screen.getByRole('heading', { name: 'Containers embarcados', level: 4 }).closest('div')!
  // Total por tipo (soma sem quebra de local): 40HC=3 (2 vazio + 1 material), 20GP=1.
  const totalPorTipo = within(containersEmbarcados).getByText('Total por tipo').closest('.app-voyage-metric-panel') as HTMLElement
  expect(within(totalPorTipo).getByText('40HC')).toBeTruthy()
  expect(within(totalPorTipo).getByText('3')).toBeTruthy()
  expect(within(totalPorTipo).getByText('20GP')).toBeTruthy()
  expect(within(totalPorTipo).getByText('1')).toBeTruthy()
  // Mini-seção por depot/terminal, cada uma com o total por tipo dentro dela.
  expect(within(containersEmbarcados).getByText('VBR')).toBeTruthy()
  expect(within(containersEmbarcados).getByText('TVV')).toBeTruthy()
})

it('exibe o aviso de containers cheios órfãos e de divergência de vazios descarregados', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [{ size_type: '40HC', is_imo: false, category: 'carga_geral' }],
      vehicles: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      vaziosImp: [{ container_type: '40HC', natureza: 'cama' }],
      dischargeDivergence: { orphanFullContainers: 2 },
      vaziosDivergence: { baplieCount: 5, moduleCount: 3, unclassifiedCount: 1, diverges: true },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  expect(screen.getByText(/2 container\(s\) cheio\(s\) no Baplie sem B\/L correspondente/)).toBeTruthy()
  expect(screen.getByText(/Baplie aponta 5 vazio\(s\) descarregado\(s\) contra 3/)).toBeTruthy()
  expect(screen.getByText(/1 ainda sem natureza classificada/)).toBeTruthy()
})

// Task 10 do ADR 2026-07-31: aviso de dado órfão — granito ou Embarque de
// Vazios lançado num porto que não é escala nenhuma da viagem.

it('verificação do plano: granito órfão em BRSSA aparece como aviso na escala BRVIX, não como seção zerada', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      granite: [],
      orphanData: { granito: [{ port: 'BRSSA', count: 3 }], vaziosEmbarcados: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const graniteSection = screen.getByRole('heading', { name: 'Carga carregada' }).closest('section')!
  expect(within(graniteSection).queryByText('Nada operado nesta escala.')).toBeNull()
  expect(within(graniteSection).getByText(/3 B\/L\(s\) de granito em BRSSA/)).toBeTruthy()
  expect(within(graniteSection).getByText(/porto não é escala desta viagem/)).toBeTruthy()
})

it('granito numa escala vizinha válida da mesma viagem não dispara o aviso de dado órfão', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      granite: [],
      orphanData: { granito: [], vaziosEmbarcados: [] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const graniteSection = screen.getByRole('heading', { name: 'Carga carregada' }).closest('section')!
  expect(within(graniteSection).getByText('Nada operado nesta escala.')).toBeTruthy()
  expect(within(graniteSection).queryByText(/porto não é escala desta viagem/)).toBeNull()
})

it('aviso de Embarque de Vazios órfão não bloqueia o sign-off da seção', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'equipamentos', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({ data: { terminal: 'TVV', signoffs: [], departmentSignoffs: [], occurrences: [] } })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], vaziosImp: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      orphanData: { granito: [], vaziosEmbarcados: [{ port: 'BRSSA', count: 4 }] },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const embarqueSection = screen.getByRole('heading', { name: 'Embarque de vazios' }).closest('section')!
  expect(within(embarqueSection).queryByText('Nenhum vazio embarcado nesta escala.')).toBeNull()
  expect(within(embarqueSection).getByText(/4 unidade\(s\) de vazios embarcados em BRSSA/)).toBeTruthy()
  fireEvent.click(within(embarqueSection).getByRole('button', { name: 'Alterar resolução de Equipamentos' }))
  expect(within(embarqueSection).getByRole('button', { name: 'Confirmado' })).toBeTruthy()
  expect(within(embarqueSection).getByRole('button', { name: 'Nada a declarar' })).toBeTruthy()
})

it('vazio sem natureza classificada no módulo não vira cover plate na listagem e exibe card único consolidado', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'documentacao', isAdmin: false })
  useAgencyReportDerivedMock.mockReturnValue({
    data: {
      containers: [], vehicles: [], granite: [], vaziosExp: [], storage: { containers: 0, days: 0 },
      operation: { os_number: null, service_qty: [] },
      vaziosImp: [
        { container_type: '40HC', natureza: 'cama' },
        { container_type: '20GP', natureza: null },
      ],
      vaziosDivergence: { baplieCount: 2, moduleCount: 2, unclassifiedCount: 1, diverges: false },
    },
    isLoading: false,
    error: null,
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const vaziosSection = screen.getByRole('heading', { name: 'Vazios descarregados' }).closest('section')!
  expect(within(vaziosSection).getByText('40HC · vazio — cama')).toBeTruthy()
  expect(within(vaziosSection).getByText('20GP · vazio')).toBeTruthy()
  expect(within(vaziosSection).queryByText('20GP · vazio — cover plate')).toBeNull()
  expect(within(vaziosSection).getByText('1 sem natureza')).toBeTruthy()
  expect(within(vaziosSection).queryByText('Módulo de Vazios de Importação')).toBeNull()
})

it('fecha o menu compacto de resolução ao pressionar Escape ou clicar fora', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  const changeButton = within(datasSection).getByRole('button', { name: 'Alterar resolução de Operações' })

  // Abre menu
  fireEvent.click(changeButton)
  expect(within(datasSection).getByRole('group', { name: 'Resolução da seção' })).toBeTruthy()

  // Pressionar Escape fecha
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(within(datasSection).queryByRole('group', { name: 'Resolução da seção' })).toBeNull()

  // Abre novamente e clica fora para fechar
  fireEvent.click(changeButton)
  expect(within(datasSection).getByRole('group', { name: 'Resolução da seção' })).toBeTruthy()
  fireEvent.mouseDown(document.body)
  expect(within(datasSection).queryByRole('group', { name: 'Resolução da seção' })).toBeNull()
})

it('observação longa sem quebras de linha exibe o botão para expandir', () => {
  useAuthMock.mockReturnValue({ effectiveRole: 'operacoes', isAdmin: false })
  useAgencyReportOwnMock.mockReturnValue({
    data: {
      signoffs: [{
        section: 'datas',
        state: 'confirmed',
        observation: 'Esta é uma observação operacional muito longa em um único parágrafo sem quebras de linha que deve ultrapassar o limite de caracteres para acionar o botão de expandir e recolher a observação completa no componente SectionObservation.',
      }],
      departmentSignoffs: [],
      occurrences: [],
    },
  })

  render(<VoyageAgencyReportTab voyageId={7} voyageLabel="NAVIO TESTE / 01E" carrierName="Armador teste" pods={[{ pod: 'BRVIX', omitted: false }]} />)

  const datasSection = screen.getByRole('heading', { name: 'Escala', level: 3 }).closest('section')!
  expect(within(datasSection).getByRole('button', { name: 'Ver observação completa' })).toBeTruthy()
  fireEvent.click(within(datasSection).getByRole('button', { name: 'Ver observação completa' }))
  expect(within(datasSection).getByRole('button', { name: 'Recolher observação' })).toBeTruthy()
})

