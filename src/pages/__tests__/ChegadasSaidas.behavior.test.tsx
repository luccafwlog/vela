// @vitest-environment jsdom

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  planSheet: vi.fn(),
  applyPlan: vi.fn(),
  readSheet: vi.fn(),
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  createOrAttach: vi.fn(),
  setShow: vi.fn(),
  effectiveRole: vi.fn(() => 'documentacao'),
  confirm: vi.fn(),
  confirmEffective: vi.fn(),
}))

const vessels = [
  {
    voyageId: 1,
    vesselName: 'ALPHA',
    voyage: '001',
    imoNumber: '9876543',
    datesByLabel: { SALVADOR: '2026-01-22' },
    omittedByLabel: {},
    earliestEta: '2026-01-22',
  },
  {
    voyageId: 2,
    vesselName: 'BETA',
    voyage: '002',
    imoNumber: null,
    datesByLabel: {},
    omittedByLabel: { VITÓRIA: true },
    earliestEta: null,
  },
]

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: vessels, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, effectiveRole: mocks.effectiveRole() }),
}))
vi.mock('../../components/ui/Toast', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))
vi.mock('../../components/ui/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../services/voyageFromSchedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/voyageFromSchedule')>()),
  createOrAttachVoyageFromSchedule: mocks.createOrAttach,
  planScheduleSheet: mocks.planSheet,
  applyScheduleSheetPlan: mocks.applyPlan,
}))
vi.mock('../../services/importCore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/importCore')>()),
  readSheet: mocks.readSheet,
}))
vi.mock('../../services/voyages', () => ({
  setVoyageShowOnPortal: mocks.setShow,
}))
vi.mock('../../services/portalScheduleVoyages', () => ({
  fetchInternalScheduleVoyages: vi.fn(),
  confirmScheduleEffectiveDate: mocks.confirmEffective,
}))

import { ChegadasSaidas } from '../ChegadasSaidas'
import { PORTAL_SCHEDULE_LANES } from '../../services/portalScheduleLanes'

// O formulário mostra Saída na origem antes da Chegada no Brasil: os portos de chegada vêm depois dos de saída.
const POL_COUNT = PORTAL_SCHEDULE_LANES.filter((lane) => lane.kind === 'pol').length

describe('ChegadasSaidas user behaviours', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOrAttach.mockResolvedValue({ voyageId: 3, created: true })
    mocks.setShow.mockResolvedValue(undefined)
    mocks.effectiveRole.mockReturnValue('documentacao')
    mocks.confirm.mockResolvedValue(true)
  })

  it('cadastra viagem publicada no Portal via createOrAttachVoyageFromSchedule', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getByRole('button', { name: /Adicionar navio/ }))
    await user.type(screen.getByLabelText(/Nome do Navio/), 'GAMMA')
    await user.type(screen.getByLabelText(/Viagem \(VOY\)/), '003')
    await user.click(screen.getAllByLabelText('Não escala')[POL_COUNT])
    await user.click(screen.getByRole('button', { name: 'Adicionar e publicar' }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(expect.objectContaining({
      vesselName: 'GAMMA',
      voyageNumber: '003',
    }), 'user-1', expect.objectContaining({ mode: 'form', voyageId: undefined }))
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-escala-schedules'] }))
  })

  it('preenche edição a partir da viagem projetada', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    expect((screen.getByLabelText(/Nome do Navio/) as HTMLInputElement).value).toBe('ALPHA')
    expect((screen.getByLabelText(/Viagem \(VOY\)/) as HTMLInputElement).value).toBe('001')
  })

  it('edicao salva com mode form e o voyageId conhecido (sem re-dedup)', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    const dateInput = screen.getByLabelText(/Salvador/) as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '2026-01-25')
    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(
      expect.objectContaining({ vesselName: 'ALPHA', voyageNumber: '001' }),
      'user-1',
      expect.objectContaining({ mode: 'form', voyageId: 1 }),
    )
  })

  it('campos de identidade ficam read-only na edicao', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    expect((screen.getByLabelText(/Nome do Navio/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText(/Viagem \(VOY\)/) as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Número IMO') as HTMLInputElement).disabled).toBe(true)
  })

  it('não oferece Remover do Portal (ADR 0071, item 12)', () => {
    render(<ChegadasSaidas />)

    expect(screen.queryAllByTitle('Remover do Portal')).toHaveLength(0)
    expect(mocks.setShow).not.toHaveBeenCalled()
  })

  it('abre MarineTraffic com IMO da viagem', () => {
    render(<ChegadasSaidas />)

    expect(screen.getByRole('link', { name: /ALPHA/ }).getAttribute('href')).toBe(
      'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
    )
  })

  it('mostra "Omitida" para escala omitida, distinto de porto sem data', () => {
    render(<ChegadasSaidas />)
    const table = within(screen.getByRole('table'))
    expect(table.getByText('Omitida')).toBeTruthy()
    expect(table.queryByText('OMIT')).toBeNull()
    expect(table.queryByText('X')).toBeNull()
  })

  it('permite escrita a Equipamentos', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    render(<ChegadasSaidas />)

    expect(screen.getByRole('button', { name: /Adicionar navio/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Importar programação' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Editar programação de/ }).length).toBeGreaterThan(0)
  })

  async function openImport(user: ReturnType<typeof userEvent.setup>, file = new File(['x'], 'programacao.xlsx')) {
    await user.click(screen.getByRole('button', { name: 'Importar programação' }))
    const dialog = screen.getByRole('dialog', { name: 'Importar programação de navios' })
    expect(within(dialog).getByRole('link', { name: 'Baixar modelo .xlsx' }).getAttribute('href')).toBe('/templates/programacao-navios-modelo.xlsx')
    await user.upload(within(dialog).getByLabelText(/Planilha de programação/), file)
    return dialog
  }

  it('planilha mostra a prévia e só grava, numa transação, ao confirmar', async () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    mocks.readSheet.mockResolvedValue({ headers: [], rows: [{ 'VESSEL NAME': 'NAVIO A', VOY: '1', IMO: '9976501' }] })
    const planRows = [
      { label: 'NAVIO A / 1', vesselName: 'NAVIO A', vesselImo: '9976501', voyageNumber: '1', voyageId: null, createsVoyage: true, changes: [{ entity_type: 'voyage_pod_schedule', port: 'BRSSA', field_name: 'eta', old_value: null, new_value: '2026-01-22', justification: '' }], error: null },
    ]
    mocks.planSheet.mockResolvedValue(planRows)
    mocks.applyPlan.mockResolvedValue({ created: 1, updated: 0, changes: 1, voyage_ids: [5] })
    const user = userEvent.setup()
    render(<ChegadasSaidas />)
    const dialog = await openImport(user)

    expect(await within(dialog).findByText('BRSSA ETA: — → 22/01/2026')).toBeTruthy()
    expect(within(dialog).getByText('Cria')).toBeTruthy()
    expect(mocks.applyPlan).not.toHaveBeenCalled()
    expect(mocks.createOrAttach).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Importar 1 viagem' }))
    expect(mocks.applyPlan).toHaveBeenCalledWith(planRows)
    expect(await within(dialog).findByRole('status', { name: 'Resultado da planilha' })).toBeTruthy()
    expect(mocks.showToast).toHaveBeenCalledWith('1 viagem criada, 0 atualizadas.', 'success')
  })

  it('qualquer linha com erro recusa a planilha inteira: nada é gravado', async () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    mocks.readSheet.mockResolvedValue({ headers: [], rows: [
      { 'VESSEL NAME': 'NAVIO A', VOY: '1', IMO: '9976501', rowNumber: 2 },
      { 'VESSEL NAME': 'NAVIO B', VOY: '2', 'SALVADOR ETA': '32/13/2026', rowNumber: 3 },
    ] })
    mocks.planSheet.mockResolvedValue([
      { label: 'NAVIO A / 1', vesselName: 'NAVIO A', vesselImo: '9976501', voyageNumber: '1', voyageId: null, createsVoyage: true, changes: [], error: null },
      { label: 'NAVIO B / 2', vesselName: 'NAVIO B', vesselImo: null, voyageNumber: '2', voyageId: null, createsVoyage: false, changes: [], error: 'Viagem 2 ambígua' },
    ])
    const user = userEvent.setup()
    render(<ChegadasSaidas />)
    const dialog = await openImport(user)

    expect(await within(dialog).findByText('NAVIO B / 2: Viagem 2 ambígua')).toBeTruthy()
    expect(within(dialog).getByText('NAVIO B / 2: data ilegível em SALVADOR ETA.')).toBeTruthy()
    const button = within(dialog).getByRole('button', { name: 'Importar 1 viagem' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await user.click(button)
    expect(mocks.applyPlan).not.toHaveBeenCalled()
  })

  it('planilha publica a Viagem oculta mesmo sem data que mude e atualiza opções de Viagem e Line-Up', async () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    mocks.readSheet.mockResolvedValue({ headers: [], rows: [{ 'VESSEL NAME': 'NAVIO C', VOY: '3', IMO: 'TBA' }] })
    const planRows = [
      { label: 'NAVIO C / 3', vesselName: 'NAVIO C', vesselImo: null, ignoredImo: 'TBA', voyageNumber: '3', voyageId: 9, createsVoyage: false, publishes: true, changes: [], error: null },
    ]
    mocks.planSheet.mockResolvedValue(planRows)
    mocks.applyPlan.mockResolvedValue({ created: 0, updated: 1, changes: 0, voyage_ids: [9] })
    const user = userEvent.setup()
    render(<ChegadasSaidas />)
    const dialog = await openImport(user)

    expect(await within(dialog).findByText('Publica no Portal')).toBeTruthy()
    expect(dialog.textContent).toMatch(/IMO “TBA” ignorado/)

    await user.click(within(dialog).getByRole('button', { name: 'Importar 1 viagem' }))
    expect(mocks.applyPlan).toHaveBeenCalledWith(planRows)
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-options'] }))
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-pod-schedules'] })
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['lineup-tv-v3'] })
  })

  it('mantém a falha de leitura da planilha no conteúdo, não só no toast', async () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    const user = userEvent.setup()
    render(<ChegadasSaidas />)
    const big = new File(['x'], 'programacao.xlsx')
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })

    const dialog = await openImport(user, big)

    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/Não foi possível ler a planilha.*Nada foi gravado/)
    expect(mocks.createOrAttach).not.toHaveBeenCalled()
    expect(mocks.applyPlan).not.toHaveBeenCalled()
  })

  it('permite digitar datas com zero ou limpar o campo sem desabilitar nem marcar Nao escala involuntariamente', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    const dateInput = screen.getByLabelText(/Salvador/) as HTMLInputElement
    const checkbox = screen.getAllByLabelText('Não escala')[POL_COUNT] as HTMLInputElement

    expect(dateInput.disabled).toBe(false)
    expect(checkbox.checked).toBe(false)

    // Simula digitacao intermediaria onde o browser zera o valor (ex: tecla 0)
    await user.clear(dateInput)
    expect(dateInput.value).toBe('')
    expect(dateInput.disabled).toBe(false)
    expect(checkbox.checked).toBe(false)

    // Preenche com nova data contendo zeros
    await user.type(dateInput, '2026-05-01')
    expect(dateInput.disabled).toBe(false)
    expect(checkbox.checked).toBe(false)
  })

  it('nao submete o formulario ao pressionar Enter em campo de data', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    const dateInput = screen.getByLabelText(/Salvador/)

    await user.type(dateInput, '{Enter}')
    expect(mocks.createOrAttach).not.toHaveBeenCalled()
  })

  it('ao marcar Nao escala explicitamente, limpa a data e desabilita o campo', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    const dateInput = screen.getByLabelText(/Salvador/) as HTMLInputElement
    const checkbox = screen.getAllByLabelText('Não escala')[POL_COUNT] as HTMLInputElement

    expect(checkbox.checked).toBe(false)
    expect(dateInput.disabled).toBe(false)

    await user.click(checkbox)
    expect(checkbox.checked).toBe(true)
    expect(dateInput.disabled).toBe(true)
    expect(dateInput.value).toBe('')
  })

  it('ao adicionar navio novo, permite desmarcar Nao escala e digitar nova data com zeros', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getByRole('button', { name: /Adicionar navio/ }))
    await user.type(screen.getByLabelText(/Nome do Navio/), 'DELTA')
    await user.type(screen.getByLabelText(/Viagem \(VOY\)/), '004')

    // Desmarca "Não escala" em Salvador (primeiro porto de chegada)
    await user.click(screen.getAllByLabelText('Não escala')[POL_COUNT])
    const dateInput = screen.getByLabelText(/Salvador/) as HTMLInputElement
    expect(dateInput.disabled).toBe(false)

    // Altera a data digitando valor com 0
    await user.clear(dateInput)
    await user.type(dateInput, '2026-09-08')

    await user.click(screen.getByRole('button', { name: 'Adicionar e publicar' }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselName: 'DELTA',
        voyageNumber: '004',
        lanes: expect.arrayContaining([
          expect.objectContaining({ code: 'BRSSA', date: '2026-09-08' }),
        ]),
      }),
      'user-1',
      expect.anything(),
    )
  })

  it('exibe diálogo de confirmação com diff antes e depois ao editar datas da viagem', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    const dateInput = screen.getByLabelText(/Salvador/) as HTMLInputElement
    await user.clear(dateInput)
    await user.type(dateInput, '2026-02-15')

    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar programação da viagem',
        changes: expect.arrayContaining([
          expect.objectContaining({
            field: 'Data SALVADOR',
            before: '2026-01-22',
            after: '2026-02-15',
          }),
        ]),
        consequence: expect.stringContaining('Portal'),
        reversibility: expect.any(String),
      }),
    )
    expect(mocks.createOrAttach).toHaveBeenCalled()
  })

  it('não abre diálogo de confirmação nem chama API ao tentar salvar sem alterações', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.createOrAttach).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledWith('Nenhuma alteração para salvar.', 'info')
  })

  it('consolida aviso de "não escala" no mesmo diálogo de confirmação com tom de perigo', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByRole('button', { name: /^Editar programação de/ })[0])
    // Desmarca "Não escala" em Vitória (preenche data automaticamente)
    const vitoriaCheckbox = screen.getAllByLabelText('Não escala')[POL_COUNT + 1] as HTMLInputElement
    await user.click(vitoriaCheckbox)

    // Marca Salvador como não escala
    const salvadorCheckbox = screen.getAllByLabelText('Não escala')[POL_COUNT] as HTMLInputElement
    await user.click(salvadorCheckbox)

    await user.click(screen.getByRole('button', { name: /Salvar/ }))

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Salvar programação da viagem',
        tone: 'danger',
        consequence: expect.stringContaining('não escala'),
      }),
    )
    expect(mocks.createOrAttach).toHaveBeenCalled()
  })

  // Revisão de 2026-10-22 (B1, ADR 0097): a célula vencida (âmbar) tem
  // Confirmar; a chegada pede data e hora, como o modal da Escala.
  it('confirma a chegada vencida com data e hora pela célula âmbar', async () => {
    const user = userEvent.setup()
    mocks.confirmEffective.mockResolvedValue(undefined)
    render(<ChegadasSaidas />)
    await user.click(screen.getByRole('button', { name: 'Confirmar chegada de ALPHA / 001 em SALVADOR' }))
    const dialog = screen.getByRole('dialog', { name: /Confirmar chegada · ALPHA \/ 001/ })
    expect((within(dialog).getByLabelText('Data da chegada') as HTMLInputElement).value).toBe('2026-01-22')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar chegada' }))
    expect(within(dialog).getByRole('alert').textContent).toBe('Informe a data e a hora da chegada.')
    await user.type(within(dialog).getByLabelText('Hora da chegada'), '14:30')
    await user.click(within(dialog).getByRole('button', { name: 'Confirmar chegada' }))
    await waitFor(() => expect(mocks.confirmEffective).toHaveBeenCalledWith({ voyageId: 1, port: 'SALVADOR', kind: 'pod', value: '2026-01-22T14:30' }))
    expect(mocks.showToast).toHaveBeenCalledWith('Data efetiva confirmada.', 'success')
  })
})

