// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const { createVoyageMock, updateVoyageMock, findDuplicateMock, showOnPortalMock, setShowMock, showToastMock, recordDatesMock } = vi.hoisted(() => ({
  recordDatesMock: vi.fn(),
  showToastMock: vi.fn(),
  createVoyageMock: vi.fn(),
  updateVoyageMock: vi.fn(),
  findDuplicateMock: vi.fn(),
  showOnPortalMock: vi.fn(),
  setShowMock: vi.fn(),
}))

vi.mock('../../../services/voyages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyages')>()),
  createVoyage: createVoyageMock,
  updateVoyage: updateVoyageMock,
  findDuplicateVoyage: findDuplicateMock,
  fetchVoyageShowOnPortal: showOnPortalMock,
  setVoyageShowOnPortal: setShowMock,
}))

vi.mock('../../../services/voyageFromSchedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/voyageFromSchedule')>()),
  recordScheduleDates: recordDatesMock,
}))

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}))

vi.mock('../../ui/Toast', () => ({
  useToast: () => ({ showToast: showToastMock }),
}))

import { VoyageCreateModal } from '../VoyageCreateModal'
import { ConfirmDialogProvider } from '../../ui/ConfirmDialog'

const FIRST_PORT = 'Indicar outro 1º porto brasileiro (âncora D−7 / D−5)'

function renderModal(props: Partial<Parameters<typeof VoyageCreateModal>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ConfirmDialogProvider>
        <VoyageCreateModal
          open={true}
          onClose={vi.fn()}
          {...props}
        />
      </ConfirmDialogProvider>
    </QueryClientProvider>,
  )
}

describe('VoyageCreateModal', () => {
  afterEach(cleanup)
  beforeEach(() => {
    vi.clearAllMocks()
    createVoyageMock.mockResolvedValue({ id: 101 })
    updateVoyageMock.mockResolvedValue({ id: 101 })
    findDuplicateMock.mockResolvedValue(null)
    showOnPortalMock.mockResolvedValue(false)
    setShowMock.mockResolvedValue(undefined)
    recordDatesMock.mockResolvedValue(undefined)
  })

  it('abre com navio, número e o seletor de portos; armador fica numa linha', async () => {
    const user = userEvent.setup()
    renderModal()
    expect(screen.getByLabelText('Navio')).toBeTruthy()
    expect(screen.getByLabelText('Numero da viagem')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Portos e datas' })).toBeTruthy()
    // Dois seletores, cada um com o lado e o efeito escritos; nenhum porto
    // listado até o operador adicionar.
    expect(screen.getByRole('heading', { name: 'Origem' })).toBeTruthy()
    expect(screen.getByText('Saída do navio no exterior (ETD). Aparece em Chegadas e Saídas quando o porto é coluna da programação.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Destino' })).toBeTruthy()
    expect(screen.getByText('Chegada no Brasil (ETA). Cria uma escala da viagem.')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
    expect(screen.queryByLabelText('Armador')).toBeNull()
    expect(screen.getByText('Armador: Cosco Shipping Specialized Carriers · SCAC CSSC')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Alterar armador' }))
    expect((screen.getByLabelText('Armador') as HTMLInputElement).value).toBe('Cosco Shipping Specialized Carriers')
    // A chave diz só o assunto; o estado é o da chave.
    expect(screen.getByRole('switch', { name: 'Chegadas e Saídas' }).getAttribute('aria-checked')).toBe('false')
    // Na criação o 1º porto brasileiro não aparece: a indicação é da edição.
    expect(screen.queryByLabelText(/Indicar outro 1º porto brasileiro/)).toBeNull()
  })

  it('na edição não mostra os portos e oferece o 1º porto indicado', () => {
    renderModal({ voyageId: 101, initialValues: { vesselName: 'GREEN ITAJAI', voyageNumber: '11' } })
    expect(screen.queryByRole('heading', { name: 'Portos e datas' })).toBeNull()
    expect((screen.getByLabelText(FIRST_PORT) as HTMLInputElement).disabled).toBe(false)
  })

  it('adiciona origem e destino nos seus seletores, inclusive fora de Chegadas e Saídas, e grava as datas', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    renderModal({ onSaved })
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    async function add(side: 'origem' | 'destino', port: string, date: string) {
      const portField = screen.getByLabelText(`Porto de ${side}`)
      await user.clear(portField)
      await user.type(portField, port)
      fireEvent.change(screen.getByLabelText(side === 'origem' ? 'ETD' : 'ETA'), { target: { value: date } })
      await user.click(screen.getByRole('button', { name: `Adicionar porto de ${side}` }))
    }
    await add('destino', 'santos', '2026-12-12')
    await add('origem', 'qingdao', '2026-11-04')
    // Lado errado: a tela diz para onde vai.
    await add('origem', 'salvador', '2026-12-15')
    expect(screen.getByText('Porto brasileiro vai em Destino: ele cria a escala da viagem.')).toBeTruthy()
    await add('destino', 'BRSSZ', '2026-12-20')
    expect(screen.getByText('BRSSZ já foi adicionado.')).toBeTruthy()

    const origins = screen.getByRole('list', { name: 'Portos de origem adicionados' })
    expect(within(origins).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Qingdao (CNTAO) · ETD 04/11/2026'])
    const destinations = screen.getByRole('list', { name: 'Portos de destino adicionados' })
    expect(within(destinations).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Santos (BRSSZ) · ETA 12/12/2026'])
    // Os portos recusados continuam digitados; apagados, o cadastro segue.
    for (const [side, date] of [['origem', 'ETD'], ['destino', 'ETA']] as const) {
      await user.clear(screen.getByLabelText(`Porto de ${side}`))
      fireEvent.change(screen.getByLabelText(date), { target: { value: '' } })
    }
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    await waitFor(() => expect(recordDatesMock).toHaveBeenCalledTimes(1))
    expect(recordDatesMock).toHaveBeenCalledWith(101, [
      { code: 'BRSSZ', kind: 'pod', date: '2026-12-12' },
      { code: 'CNTAO', kind: 'pol', date: '2026-11-04' },
    ], 'user-1')
    expect(showToastMock).toHaveBeenCalledWith('Viagem cadastrada com sucesso.', 'success')
    expect(onSaved).toHaveBeenCalledWith(101)
  })

  it('pede a data antes de adicionar e remove o porto adicionado', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByLabelText('Porto de destino'), 'salvador')
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    expect(screen.getByText('Informe o ETA.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('ETA'), { target: { value: '2026-12-15' } })
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    await user.click(screen.getByRole('button', { name: 'Remover BRSSA' }))
    expect(screen.queryByRole('list', { name: 'Portos de destino adicionados' })).toBeNull()
  })

  it('sem porto adicionado, não grava datas', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    await waitFor(() => expect(createVoyageMock).toHaveBeenCalled())
    expect(recordDatesMock).not.toHaveBeenCalled()
  })

  it('datas recusadas: a viagem fica cadastrada e a tela diz que as datas não foram gravadas', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    recordDatesMock.mockRejectedValue(new Error('fetch failed'))
    renderModal({ onSaved })
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    await user.type(screen.getByLabelText('Porto de destino'), 'salvador')
    fireEvent.change(screen.getByLabelText('ETA'), { target: { value: '2026-12-15' } })
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(
      'Viagem cadastrada, mas as datas dos portos não foram gravadas (falha na gravação das datas). Informe-as nas escalas da ficha da viagem.',
      'error',
    ))
    expect(onSaved).toHaveBeenCalledWith(101)
  })

  it('porto digitado e não adicionado: recusa o cadastro em vez de criar a viagem sem ele', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    await user.type(screen.getByLabelText('Porto de destino'), 'santos')
    fireEvent.change(screen.getByLabelText('ETA'), { target: { value: '2026-12-12' } })
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    expect(await screen.findByText('Adicione ou apague este porto de destino antes de cadastrar a viagem.')).toBeTruthy()
    expect(createVoyageMock).not.toHaveBeenCalled()

    // Adicionado, o cadastro segue com a escala.
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    expect(screen.queryByText('Adicione ou apague este porto de destino antes de cadastrar a viagem.')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    await waitFor(() => expect(recordDatesMock).toHaveBeenCalledWith(101, [{ code: 'BRSSZ', kind: 'pod', date: '2026-12-12' }], 'user-1'))
  })

  it('porto só digitado conta como alteração: Voltar pede confirmação', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.type(screen.getByLabelText('Porto de origem'), 'qingdao')
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(await screen.findByText('Descartar alterações?')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('com portos e Chegadas e Saídas ligada, publica só depois de gravar as datas', async () => {
    const user = userEvent.setup()
    const order: string[] = []
    recordDatesMock.mockImplementation(async () => { order.push('datas') })
    setShowMock.mockImplementation(async () => { order.push('publica') })
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    await user.type(screen.getByLabelText('Porto de destino'), 'santos')
    fireEvent.change(screen.getByLabelText('ETA'), { target: { value: '2026-12-12' } })
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    await user.click(screen.getByRole('switch', { name: 'Chegadas e Saídas' }))
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    await waitFor(() => expect(setShowMock).toHaveBeenCalledWith(101, true))
    expect(createVoyageMock).toHaveBeenCalledWith(expect.anything(), 'user-1', { origin: 'viagens', showOnPortal: false })
    expect(order).toEqual(['datas', 'publica'])
    expect(showToastMock).toHaveBeenCalledWith('Viagem cadastrada com sucesso.', 'success')
  })

  it('datas recusadas com Chegadas e Saídas ligada: a viagem não vai ao ar sem datas', async () => {
    const user = userEvent.setup()
    recordDatesMock.mockRejectedValue(new Error('fetch failed'))
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN TESTE')
    await user.type(screen.getByLabelText('Numero da viagem'), '77N')
    await user.type(screen.getByLabelText('Porto de destino'), 'santos')
    fireEvent.change(screen.getByLabelText('ETA'), { target: { value: '2026-12-12' } })
    await user.click(screen.getByRole('button', { name: 'Adicionar porto de destino' }))
    await user.click(screen.getByRole('switch', { name: 'Chegadas e Saídas' }))
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(
      'Viagem cadastrada, mas as datas dos portos não foram gravadas (falha na gravação das datas). Informe-as nas escalas da ficha da viagem e ligue Chegadas e Saídas depois.',
      'error',
    ))
    expect(createVoyageMock).toHaveBeenCalledWith(expect.anything(), 'user-1', { origin: 'viagens', showOnPortal: false })
    expect(setShowMock).not.toHaveBeenCalled()
  })

  it('limpa os campos indicados ao desativar o toggle', async () => {
    const user = userEvent.setup()
    renderModal({
      voyageId: 101,
      initialValues: {
        indicatedFirstBrazilianPort: 'BRSSZ',
        indicatedFirstBrazilianEta: '2026-07-01',
      },
    })

    const checkbox = screen.getByLabelText(FIRST_PORT) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect((screen.getByLabelText('Porto indicado') as HTMLInputElement).value).toBe('BRSSZ')

    await user.click(checkbox)
    expect(checkbox.checked).toBe(false)
    expect(screen.queryByLabelText('Porto indicado')).toBeNull()
  })

  it('envia dados indicados no salvamento de nova viagem', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    renderModal({ onSaved })

    await user.type(screen.getByLabelText('Navio'), 'COSCO SHIPPING PLAN')
    await user.type(screen.getByLabelText('Numero da viagem'), '045E')

    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))

    expect(createVoyageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vesselName: 'COSCO SHIPPING PLAN',
        voyageNumber: '045E',
      }),
      'user-1',
      { origin: 'viagens', showOnPortal: false },
    )
  })

  // Revisão de 2026-10-22 (A2): a Viagem nova pode nascer em Chegadas e Saídas.
  it('liga a aparição em Chegadas e Saídas no cadastro', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    const toggle = screen.getByRole('switch', { name: 'Chegadas e Saídas' })
    await user.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(createVoyageMock).toHaveBeenCalledWith(expect.objectContaining({ voyageNumber: '11' }), 'user-1', { origin: 'viagens', showOnPortal: true })
  })

  // Revisão de 2026-10-22 (A1): navio e número já cadastrados.
  it('recusa navio e número já cadastrados antes de gravar, com a viagem existente', async () => {
    const user = userEvent.setup()
    findDuplicateMock.mockResolvedValue({ id: 9, label: 'GREEN ITAJAI / 11', cancelled: false })
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(await screen.findByText('Já existe a viagem GREEN ITAJAI / 11. Abra a viagem existente em vez de cadastrar outra.')).toBeTruthy()
    expect(findDuplicateMock).toHaveBeenCalledWith(expect.objectContaining({ vesselName: 'GREEN ITAJAI', voyageNumber: '11', excludeVoyageId: null }))
    expect(createVoyageMock).not.toHaveBeenCalled()
  })

  it('mostra a recusa do banco por duplicidade junto do número, não como falha genérica', async () => {
    const user = userEvent.setup()
    createVoyageMock.mockRejectedValue({ code: '23505', message: 'Já existe a viagem GREEN ITAJAI / 11, cancelada. Reative-a em Viagens em vez de cadastrar outra.' })
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    expect(await screen.findByText(/Reative-a em Viagens/)).toBeTruthy()
  })

  // Recusa de regra do cadastro do navio (IMO conflitante) chega com o
  // motivo, não como "Falha ao cadastrar viagem".
  it('mostra o motivo da recusa do cadastro do navio, não a falha genérica', async () => {
    const user = userEvent.setup()
    const { voyageRegistrationRefusal } = await import('../../../services/voyages')
    createVoyageMock.mockRejectedValue(voyageRegistrationRefusal('Navio GREEN ITAJAI com IMO conflitante (1111111 vs 2222222). Corrija antes de importar.'))
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith(
      'Navio GREEN ITAJAI com IMO conflitante (1111111 vs 2222222). Corrija antes de importar.',
      'error',
    ))
  })

  it('falha sem motivo para a tela continua com o texto genérico', async () => {
    const user = userEvent.setup()
    createVoyageMock.mockRejectedValue(new Error('fetch failed'))
    renderModal()
    await user.type(screen.getByLabelText('Navio'), 'GREEN ITAJAI')
    await user.type(screen.getByLabelText('Numero da viagem'), '11')
    await user.click(screen.getByRole('button', { name: 'Cadastrar viagem' }))
    await waitFor(() => expect(showToastMock).toHaveBeenCalledWith('Falha ao cadastrar viagem. Revise os dados e tente novamente.', 'error'))
  })

  it('na edição, publica a viagem oculta e tira a que já aparece', async () => {
    const user = userEvent.setup()
    renderModal({ voyageId: 101, initialValues: { vesselName: 'GREEN ITAJAI', voyageNumber: '11' } })
    const toggle = await screen.findByRole('switch', { name: 'Chegadas e Saídas' })
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'Salvar viagem' }))
    await waitFor(() => expect(setShowMock).toHaveBeenCalledWith(101, true))
    // Mesmo navio e número: a edição não confere duplicidade.
    expect(findDuplicateMock).not.toHaveBeenCalled()

    cleanup()
    showOnPortalMock.mockResolvedValue(true)
    renderModal({ voyageId: 101, initialValues: { vesselName: 'GREEN ITAJAI', voyageNumber: '11' } })
    const shown = await screen.findByRole('switch', { name: 'Chegadas e Saídas' })
    await waitFor(() => expect(shown.getAttribute('aria-checked')).toBe('true'))
    await waitFor(() => expect((shown as HTMLButtonElement).disabled).toBe(false))
    setShowMock.mockClear()
    await user.click(shown)
    await user.click(screen.getByRole('button', { name: 'Salvar viagem' }))
    // ADR 0097: desligar tira a viagem da Programação do Vela e do Portal.
    await waitFor(() => expect(setShowMock).toHaveBeenCalledWith(101, false))
  })

  it('pede confirmação antes de descartar alterações não salvas', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })

    await user.type(screen.getByLabelText('Navio'), 'QA SCRATCH')
    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.getByRole('heading', { name: 'Descartar alterações?' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Descartar alterações' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('fecha diretamente sem confirmação quando o formulário permanece limpo', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: 'Descartar alterações?' })).toBeNull()
  })
})
