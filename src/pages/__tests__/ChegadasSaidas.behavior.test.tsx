// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  showToast: vi.fn(),
  createOrAttach: vi.fn(),
  setShow: vi.fn(),
  effectiveRole: vi.fn(() => 'documentacao'),
  confirm: vi.fn(),
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
vi.mock('../../services/voyageFromSchedule', () => ({
  createOrAttachVoyageFromSchedule: mocks.createOrAttach,
}))
vi.mock('../../services/voyages', () => ({
  setVoyageShowOnPortal: mocks.setShow,
}))
vi.mock('../../services/portalScheduleVoyages', () => ({
  fetchPortalScheduleVoyages: vi.fn(),
}))

import { ChegadasSaidas } from '../ChegadasSaidas'

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

    await user.click(screen.getByRole('button', { name: /Adicionar Navio/ }))
    await user.type(screen.getByLabelText('Nome do Navio'), 'GAMMA')
    await user.type(screen.getByLabelText('Viagem (VOY)'), '003')
    await user.click(screen.getAllByLabelText('Não escala')[5])
    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

    expect(mocks.createOrAttach).toHaveBeenCalledWith(expect.objectContaining({
      vesselName: 'GAMMA',
      voyageNumber: '003',
    }), 'user-1', expect.objectContaining({ mode: 'form', voyageId: undefined }))
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['voyage-escala-schedules'] }))
  })

  it('preenche edição a partir da viagem projetada', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    expect((screen.getByLabelText('Nome do Navio') as HTMLInputElement).value).toBe('ALPHA')
    expect((screen.getByLabelText('Viagem (VOY)') as HTMLInputElement).value).toBe('001')
  })

  it('edicao salva com mode form e o voyageId conhecido (sem re-dedup)', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
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

    await user.click(screen.getAllByTitle('Editar')[0])
    expect((screen.getByLabelText('Nome do Navio') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Viagem (VOY)') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Número IMO') as HTMLInputElement).disabled).toBe(true)
  })

  it('não oferece Remover do Portal (ADR 0071, item 12)', () => {
    render(<ChegadasSaidas />)

    expect(screen.queryAllByTitle('Remover do Portal')).toHaveLength(0)
    expect(mocks.setShow).not.toHaveBeenCalled()
  })

  it('abre MarineTraffic com IMO da viagem', () => {
    render(<ChegadasSaidas />)

    expect(screen.getByRole('link', { name: 'ALPHA' }).getAttribute('href')).toBe(
      'https://www.marinetraffic.com/en/ais/details/ships/imo:9876543',
    )
  })

  it('mostra OMIT para escala omitida, distinto de X', () => {
    render(<ChegadasSaidas />)
    expect(screen.getByText('OMIT')).toBeTruthy()
    expect(screen.getAllByText('X').length).toBeGreaterThan(0)
  })

  it('permite escrita a Equipamentos', () => {
    mocks.effectiveRole.mockReturnValue('equipamentos')
    render(<ChegadasSaidas />)

    expect(screen.getByRole('button', { name: /Adicionar Navio/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Fazer Upload/ })).toBeTruthy()
    expect(screen.getAllByTitle('Editar').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Baixar Planilha Modelo/ })).toBeTruthy()
  })

  it('permite digitar datas com zero ou limpar o campo sem desabilitar nem marcar Nao escala involuntariamente', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    const dateInput = screen.getByLabelText(/SALVADOR/) as HTMLInputElement
    const checkbox = screen.getAllByLabelText('Não escala')[5] as HTMLInputElement

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

    await user.click(screen.getAllByTitle('Editar')[0])
    const dateInput = screen.getByLabelText(/SALVADOR/)

    await user.type(dateInput, '{Enter}')
    expect(mocks.createOrAttach).not.toHaveBeenCalled()
  })

  it('ao marcar Nao escala explicitamente, limpa a data e desabilita o campo', async () => {
    const user = userEvent.setup()
    render(<ChegadasSaidas />)

    await user.click(screen.getAllByTitle('Editar')[0])
    const dateInput = screen.getByLabelText(/SALVADOR/) as HTMLInputElement
    const checkbox = screen.getAllByLabelText('Não escala')[5] as HTMLInputElement

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

    await user.click(screen.getByRole('button', { name: /Adicionar Navio/ }))
    await user.type(screen.getByLabelText('Nome do Navio'), 'DELTA')
    await user.type(screen.getByLabelText('Viagem (VOY)'), '004')

    // Desmarca "Não escala" em Salvador (lane index 5)
    await user.click(screen.getAllByLabelText('Não escala')[5])
    const dateInput = screen.getByLabelText(/SALVADOR/) as HTMLInputElement
    expect(dateInput.disabled).toBe(false)

    // Altera a data digitando valor com 0
    await user.clear(dateInput)
    await user.type(dateInput, '2026-09-08')

    await user.click(screen.getByRole('button', { name: 'Adicionar' }))

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
})
