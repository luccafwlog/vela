// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, useLocation } from 'react-router-dom'
import type { PortalOperationBL } from '../../services/portalOperation'

const rows: PortalOperationBL[] = [
  {
    bl_id: 'BL001',
    ce_mercante: '123456789012345',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 10,
    voyage_number: '001W',
    vessel_name: 'NAVIO TESTE',
    local_charges: { status: 'open', total_brl: 4804, balance_brl: 1202 },
    transshipment: {
        omission_id: 9,
        disposition: 'transshipment',
        omitted_pod: 'BRVIX',
        discharge_pod: 'BRSSZ',
        onward_vessel_name: 'COSCO STAR',
        onward_carrier: null,
        onward_voyage_number: 'T-1',
        onward_etd: '2026-07-20',
        onward_eta: '2026-07-22',
    },
    container_count: 2,
    containers_in_demurrage: 1,
    containers_returned: 1,
    containers: [
      {
        id: 1,
        container_number: 'ABCD1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-20',
        usage_days: 19,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 2,
        container_number: 'EFGH1234567',
        type: '20RF',
        discharge_date: '2026-06-01',
        return_date: null,
        usage_days: 25,
        free_time_days: 10,
        demurrage_days: 15,
        status: 'em_demurrage',
      },
    ],
  },
  {
    bl_id: 'BL002',
    ce_mercante: null,
    pol: 'CNSHA',
    pod: 'BRSSZ',
    voyage_id: 11,
    voyage_number: '002W',
    vessel_name: 'NAVIO SEM CONTAINER',
    local_charges: { status: 'none', total_brl: null, balance_brl: null },
    transshipment: {
      omission_id: 10,
      disposition: 'cod',
      omitted_pod: 'BRVIX',
      discharge_pod: 'BRSSA',
      onward_vessel_name: null,
      onward_carrier: null,
      onward_voyage_number: null,
      onward_etd: null,
      onward_eta: null,
    },
    container_count: 0,
    containers_in_demurrage: 0,
    containers_returned: 0,
    containers: [],
  },
  {
    bl_id: 'BL003',
    ce_mercante: '987654321098765',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 12,
    voyage_number: '003W',
    vessel_name: 'NAVIO DEVOLVIDO',
    local_charges: { status: 'paid', total_brl: 2702, balance_brl: 0 },
    container_count: 2,
    containers_in_demurrage: 0,
    containers_returned: 2,
    containers: [
      {
        id: 3,
        container_number: 'IJKL1234567',
        type: '40GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-15',
        usage_days: 14,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
      {
        id: 4,
        container_number: 'MNOP1234567',
        type: '20GP',
        discharge_date: '2026-06-01',
        return_date: '2026-06-16',
        usage_days: 15,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'devolvido',
      },
    ],
  },
  {
    bl_id: 'BL004',
    ce_mercante: '555666777888999',
    pol: 'CNSHA',
    pod: 'BRVIX',
    voyage_id: 13,
    voyage_number: '004W',
    vessel_name: 'NAVIO MISTO',
    local_charges: { status: 'awaiting_invoice', total_brl: null, balance_brl: null },
    cargo_mode: 'misto',
    bb_weight_ton: 12.5,
    bb_packages_qty: 4,
    container_count: 1,
    containers_in_demurrage: 0,
    containers_returned: 1,
    containers: [
      {
        id: 5,
        container_number: 'MIXU9999999',
        type: '40HC',
        discharge_date: '2026-06-01',
        return_date: '2026-06-12',
        usage_days: 11,
        free_time_days: 15,
        demurrage_days: 0,
        status: 'devolvido',
      },
    ],
  },
  {
    bl_id: 'BL005',
    ce_mercante: '111222333444555',
    pol: 'CNSHA',
    pod: 'BRSSA',
    voyage_id: 14,
    voyage_number: '005W',
    vessel_name: 'NAVIO CARGA SOLTA',
    local_charges: { status: 'none', total_brl: null, balance_brl: null },
    cargo_mode: 'carga_solta',
    bb_weight_ton: 64.5,
    bb_packages_qty: 3,
    container_count: 0,
    containers_in_demurrage: 0,
    containers_returned: 0,
    containers: [],
  },
  {
    bl_id: 'BL006',
    ce_mercante: '666777888999000',
    pol: 'CNNGB',
    pod: 'BRSSA',
    voyage_id: 15,
    voyage_number: '006W',
    vessel_name: 'NAVIO FREE TIME',
    local_charges: { status: 'open', total_brl: 2702, balance_brl: 2702 },
    container_count: 1,
    containers_in_demurrage: 0,
    containers_returned: 0,
    containers: [
      {
        id: 6,
        container_number: 'FREE1234567',
        type: '20GP',
        discharge_date: '2026-10-05',
        return_date: null,
        usage_days: 12,
        free_time_days: 21,
        demurrage_days: 0,
        status: 'dentro_free_time',
      },
    ],
  },
]

vi.mock('../../hooks/usePortalOperation', () => ({
  usePortalOperationBls: () => ({ data: rows, isLoading: false, error: null }),
}))
vi.mock('../../services/exports', () => ({
  exportPortalBlsWorkbook: vi.fn(),
  exportPortalContainersWorkbook: vi.fn(),
}))

import { PortalOperacao } from '../PortalOperacao'
import { exportPortalBlsWorkbook, exportPortalContainersWorkbook } from '../../services/exports'

afterEach(cleanup)

function SearchProbe() {
  return <div data-testid="search">{useLocation().search}</div>
}

function renderOperacao(initialEntry = '/portal/operacao') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <PortalOperacao />
      <SearchProbe />
    </MemoryRouter>,
  )
}

// jsdom não aplica o CSS: tabela e cartões do celular ficam no DOM juntos.
const blsTable = () => screen.getByRole('table', { name: /B\/Ls da operação/ })
const containersTable = () => screen.getByRole('table', { name: 'Containers da operação do cliente' })
const blRow = (bl: string) => within(blsTable()).getByRole('button', { name: `Abrir os containers do B/L ${bl}` }).closest('tr') as HTMLElement

describe('PortalOperacao (BLs e Containers)', () => {
  it('mostra os atalhos uma vez só, no título da página, sem Agentes do porto', async () => {
    const user = userEvent.setup()
    renderOperacao()
    await user.click(screen.getByRole('button', { name: 'Abrir os containers do B/L BL001' }))

    expect(screen.getAllByRole('link', { name: 'Depósitos de devolução' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Depósitos de devolução' }).getAttribute('href')).toBe('/portal/informacoes/devolucao')
    expect(screen.getAllByRole('link', { name: 'Tracking do B/L' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Tracking do B/L' }).getAttribute('href')).toBe('/portal/informacoes/tracking')
    expect(screen.getAllByRole('link', { name: 'Solicitar desbloqueio de CE' })).toHaveLength(1)
    expect(screen.queryByRole('link', { name: 'Agentes do porto' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Consultar Taxas Locais' })).toBeNull()
  })

  it('distingue tarifa indisponível de dentro do free time e permite filtrar a unidade', async () => {
    const container = rows[0].containers[1]
    const previous = { ...container }
    Object.assign(container, { status: 'tarifa_indisponivel', free_time_days: null, demurrage_days: null })
    try {
      const user = userEvent.setup()
      renderOperacao('/portal/operacao?tab=containers')
      const row = within(containersTable()).getByText(container.container_number).closest('tr') as HTMLElement
      expect(within(row).getByText('Tarifa indisponível')).toBeTruthy()
      expect(within(row).queryByText(/No free time/)).toBeNull()
      await user.click(screen.getByRole('button', { name: /Filtros/i }))
      await user.selectOptions(screen.getByLabelText('Status operacional'), 'tarifa_indisponivel')
      expect(within(containersTable()).getByText(container.container_number)).toBeTruthy()
      expect(within(containersTable()).queryByText('ABCD1234567')).toBeNull()
    } finally { Object.assign(container, previous) }
  })

  it('mostra a tabela limpa da aba BLs: Navio / Viagem, Trecho, Carga, Taxas locais, Pagamento, Devolução e Demurrage', () => {
    renderOperacao()
    expect(screen.getByRole('heading', { name: 'BLs e Containers' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'BLs' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Containers' })).toBeTruthy()

    const headers = within(blsTable()).getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['Abrir containers', 'B/L', 'CE Mercante', 'Navio / Viagem', 'Trecho', 'Carga', 'Taxas locais', 'Pagamento', 'Devolução', 'Demurrage'])

    const open = blRow('BL001')
    expect(within(open).getByText('NAVIO TESTE / 001W')).toBeTruthy()
    expect(open.textContent).toContain('CNSHA → BRVIX')
    expect(within(open).getByText('2 containers')).toBeTruthy()
    expect(within(open).getByText('R$ 4.804,00')).toBeTruthy()
    expect(within(open).getByText('R$ 1.202,00 em aberto').closest('.app-status-text--warning')).not.toBeNull()
    expect(within(open).getByText('1 de 2 devolvidos').closest('.app-status-text--warning')).not.toBeNull()
    expect(within(open).getByText('1 em demurrage').closest('.app-status-text--danger')).not.toBeNull()
    // CE como texto com copiar, sem selo "CE …".
    expect(within(open).getByText('123456789012345')).toBeTruthy()
    expect(within(open).queryByText(/^CE /)).toBeNull()

    const paid = blRow('BL003')
    expect(within(paid).getByText('R$ 2.702,00')).toBeTruthy()
    expect(within(paid).getByText('Pago').closest('.app-status-text--paid')).not.toBeNull()
    expect(within(paid).getByText('2 de 2 devolvidos').closest('.app-status-text--warning')).toBeNull()
    expect(within(paid).getByText('Nenhum')).toBeTruthy()

    const awaiting = blRow('BL004')
    expect(within(awaiting).getByText('Aguardando fatura').closest('.app-status-text--warning')).toBeNull()
    expect(within(awaiting).getByText('Sem valor de fatura')).toBeTruthy()
    expect(within(awaiting).getByText('1 container + 12,5 t')).toBeTruthy()

    const looseCargo = blRow('BL005')
    expect(within(looseCargo).getByText('Carga solta · 64,5 t')).toBeTruthy()
    expect(within(looseCargo).getByText('Sem fatura')).toBeTruthy()
    expect(within(looseCargo).getAllByText('Sem containers')).toHaveLength(2)
  })

  it('filtra pelos cartões da aba BLs no lugar da contagem "B/L(s) encontrado(s)"', async () => {
    const user = userEvent.setup()
    renderOperacao()
    expect(screen.queryByText(/encontrado\(s\)/)).toBeNull()

    const cards = screen.getByRole('group', { name: 'Filtrar B/Ls por devolução' })
    expect(within(cards).getByRole('button', { name: /^B\/Ls\s*6$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(cards).getByRole('button', { name: /Com container sem devolução\s*2/ })).toBeTruthy()
    expect(within(cards).getByRole('button', { name: /Tudo devolvido\s*2/ })).toBeTruthy()

    await user.click(within(cards).getByRole('button', { name: /Com container em demurrage\s*1/ }))
    expect(within(blsTable()).getByText('BL001')).toBeTruthy()
    expect(within(blsTable()).queryByText('BL003')).toBeNull()

    await user.click(within(cards).getByRole('button', { name: /Com container em demurrage/ }))
    expect(within(blsTable()).getByText('BL003')).toBeTruthy()
  })

  it('marca como Cancelado o B/L cancelado depois de liberado (ADR 0071)', () => {
    rows[1].cancelled_at = '2026-09-25T10:00:00Z'
    try {
      renderOperacao()
      const cancelledRow = blRow('BL002')
      expect(within(cancelledRow).getByText('Cancelado')).toBeTruthy()
      expect(cancelledRow.className).toContain('app-table__row--muted')
      expect(within(blRow('BL001')).queryByText('Cancelado')).toBeNull()
    } finally {
      rows[1].cancelled_at = null
    }
  })

  it('filtra B/Ls por navio na aba BLs', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('Navio'), 'NAVIO TESTE')

    expect(within(blsTable()).getByText('BL001')).toBeTruthy()
    expect(within(blsTable()).queryByText('BL003')).toBeNull()
  })

  // Ponto 9: colar vários B/Ls no filtro acha cada um.
  it('filtra a aba BLs por uma lista de B/Ls colada', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: /Filtros/i }))
    await user.type(screen.getByLabelText('B/L'), 'BL001, BL003')

    expect(within(blsTable()).getByText('BL001')).toBeTruthy()
    expect(within(blsTable()).getByText('BL003')).toBeTruthy()
    expect(within(blsTable()).queryByText('BL002')).toBeNull()
  })

  it('abre a linha com os contêineres em tabela interna, Situação em texto e o transbordo', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: 'Abrir os containers do B/L BL001' }))

    expect(screen.getByRole('heading', { name: 'Informações de Transbordo' })).toBeTruthy()
    expect(screen.getByText('COSCO STAR')).toBeTruthy()
    expect(screen.getByText('20/07/2026')).toBeTruthy()
    expect(screen.getByText('22/07/2026')).toBeTruthy()
    expect(screen.queryByText('Motivo')).toBeNull()

    const inner = screen.getByRole('table', { name: 'Containers do B/L BL001' })
    expect(inner.closest('tr[data-row-detail]')).not.toBeNull()
    expect(within(inner).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Container', 'Tipo', 'Descarga', 'Devolução', 'Dias de uso', 'Free time', 'Dias em demurrage', 'Situação'])
    const demurrage = within(inner).getByText('EFGH1234567').closest('tr') as HTMLElement
    expect(within(demurrage).getByText('Em demurrage').closest('.app-status-text--danger')).not.toBeNull()
    expect(within(demurrage).getByText('Ainda não devolvido')).toBeTruthy()
    // Sem selo: a situação é texto.
    expect(inner.querySelector('[class*="badge"]')).toBeNull()
  })

  it('exibe um bloco próprio para COD sem publicar dados de transbordo', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('button', { name: 'Abrir os containers do B/L BL002' }))

    expect(screen.getByRole('heading', { name: 'Destino alterado para BRSSA (COD)' })).toBeTruthy()
    expect(screen.getByText('Sua carga não seguirá em transbordo.')).toBeTruthy()
    const codCard = screen.getByRole('heading', { name: 'Destino alterado para BRSSA (COD)' }).closest('section')
    expect(codCard).not.toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Navio')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Armador')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Viagem')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('ETD')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('ETA')).toBeNull()
    expect(within(codCard as HTMLElement).queryByText('Motivo')).toBeNull()
  })

  it('mostra a aba Containers com 10 colunas, sem CE, Navio, Viagem e POL, e a situação em texto', async () => {
    const user = userEvent.setup()
    renderOperacao()

    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    const headers = within(containersTable()).getAllByRole('columnheader').map((th) => th.textContent)
    expect(headers).toEqual(['Container', 'Tipo', 'B/L', 'POD', 'Descarga', 'Devolução', 'Dias de uso', 'Free time', 'Dias em demurrage', 'Situação'])

    // Containers de todos os B/Ls aparecem sem precisar abrir o B/L.
    const freeTime = within(containersTable()).getByText('FREE1234567').closest('tr') as HTMLElement
    expect(within(freeTime).getByText('No free time · 9 dias').closest('.app-status-text--warning')).not.toBeNull()
    const returned = within(containersTable()).getByText('ABCD1234567').closest('tr') as HTMLElement
    expect(within(returned).getByText('Devolvido').closest('.app-status-text')).toBeNull()
    expect(within(containersTable()).getByText('IJKL1234567')).toBeTruthy()
  })

  it('filtra pelos cartões da aba Containers, com "Sem devolução, no free time" fora da demurrage', async () => {
    const user = userEvent.setup()
    renderOperacao('/portal/operacao?tab=containers')

    const cards = screen.getByRole('group', { name: 'Filtrar containers por devolução' })
    expect(within(cards).getByRole('button', { name: /^Containers\s*6$/ })).toBeTruthy()
    expect(within(cards).getByRole('button', { name: /Em demurrage\s*1/ })).toBeTruthy()
    expect(within(cards).getByRole('button', { name: /Devolvidos\s*4/ })).toBeTruthy()

    await user.click(within(cards).getByRole('button', { name: /Sem devolução, no free time\s*1/ }))
    expect(within(containersTable()).getByText('FREE1234567')).toBeTruthy()
    expect(within(containersTable()).queryByText('EFGH1234567')).toBeNull()
    expect(within(containersTable()).queryByText('ABCD1234567')).toBeNull()
  })

  it('renderiza cards mobile nas abas BLs e Containers, sem os botões repetidos', async () => {
    const user = userEvent.setup()
    renderOperacao()

    const blCards = screen.getByTestId('portal-operacao-bl-mobile-cards')
    expect(within(blCards).getByRole('article', { name: 'B/L BL001' }).textContent).toMatch(/R\$\s1\.202,00 em aberto/)
    expect(within(blCards).queryAllByRole('link')).toHaveLength(0)

    await user.click(screen.getByRole('tab', { name: 'Containers' }))

    const containerCards = screen.getByTestId('portal-operacao-container-mobile-cards')
    expect(within(containerCards).getByRole('article', { name: 'Container ABCD1234567' })).toBeTruthy()
    expect(within(containerCards).queryAllByRole('link')).toHaveLength(0)
  })

  it('abre a aba Containers filtrada por demurrage via query param', () => {
    renderOperacao('/portal/operacao?tab=containers&devolucao=em_demurrage')
    // Apenas EFGH (em demurrage, sem devolucao) deve aparecer
    expect(within(containersTable()).getByText('EFGH1234567')).toBeTruthy()
    expect(within(containersTable()).queryByText('ABCD1234567')).toBeNull()
    expect(within(containersTable()).queryByText('IJKL1234567')).toBeNull()
    const cards = screen.getByRole('group', { name: 'Filtrar containers por devolução' })
    expect(within(cards).getByRole('button', { name: /Em demurrage/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('US-172: exporta os B/Ls e os containers para Excel', async () => {
    const user = userEvent.setup()
    renderOperacao()

    // aba BLs: exporta B/Ls
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))
    expect(exportPortalBlsWorkbook).toHaveBeenCalledTimes(1)
    expect((exportPortalBlsWorkbook as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(rows.length)

    // aba Containers: exporta containers
    await user.click(screen.getByRole('tab', { name: 'Containers' }))
    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }))
    expect(exportPortalContainersWorkbook).toHaveBeenCalledTimes(1)
  })

  it('apresenta B/L misto como documento unico com contêineres e sumario de carga solta', async () => {
    const user = userEvent.setup()
    renderOperacao()

    // B/L misto exibe indicador composto de contêineres e carga solta
    expect(within(blsTable()).getByText('1 container + 12,5 t')).toBeTruthy()

    // Ao expandir o B/L misto
    await user.click(screen.getByRole('button', { name: 'Abrir os containers do B/L BL004' }))

    // Exibe sumário de carga solta (breakbulk)
    const summary = screen.getByTestId('portal-breakbulk-summary')
    expect(within(summary).getByText('12,5 t')).toBeTruthy()
    expect(within(summary).getByText('4')).toBeTruthy()

    // Exibe contêiner e situação normalmente
    const inner = screen.getByRole('table', { name: 'Containers do B/L BL004' })
    expect(within(inner).getByText('MIXU9999999')).toBeTruthy()
    expect(within(inner).getByText('40HC')).toBeTruthy()
  })
})

// Ponto 2 de 2026-10-23: o atalho "Ver meus B/Ls" de Chegadas e saídas chega
// pela URL; recarregar a página mantém o filtro de Navio e Viagem.
describe('PortalOperacao: Navio e Viagem na URL', () => {
  it('abre a aba BLs já filtrada pelo navio e pela viagem do endereço', () => {
    renderOperacao('/portal/operacao?tab=bls&navio=NAVIO+DEVOLVIDO&viagem=003W')
    expect((screen.getByLabelText('Navio') as HTMLInputElement).value).toBe('NAVIO DEVOLVIDO')
    expect((screen.getByLabelText('Viagem') as HTMLInputElement).value).toBe('003W')
    const shown = within(blsTable()).getAllByRole('button', { name: /Abrir os containers do B\/L/ }).map((b) => b.getAttribute('aria-label'))
    expect(shown).toEqual(['Abrir os containers do B/L BL003'])
  })

  it('digitar ou limpar Navio e Viagem atualiza a URL', async () => {
    const user = userEvent.setup()
    renderOperacao('/portal/operacao?tab=bls&navio=NAVIO+DEVOLVIDO&viagem=003W')
    await user.clear(screen.getByLabelText('Viagem'))
    expect(new URLSearchParams(screen.getByTestId('search').textContent ?? '').get('viagem')).toBeNull()
    await user.clear(screen.getByLabelText('Navio'))
    await user.type(screen.getByLabelText('Navio'), 'MISTO')
    const params = new URLSearchParams(screen.getByTestId('search').textContent ?? '')
    expect(params.get('navio')).toBe('MISTO')
    expect(params.get('tab')).toBe('bls')
  })

  // O roteador troca o endereço numa transição: o campo lido da URL voltava ao
  // valor antigo a cada tecla e o texto digitado no meio ia para o fim.
  it('digitar no meio do Navio mantém o cursor no lugar', async () => {
    const user = userEvent.setup()
    renderOperacao('/portal/operacao?tab=bls&navio=NAVIO&viagem=003W')
    const navio = screen.getByLabelText('Navio') as HTMLInputElement
    await user.type(navio, 'XY', { initialSelectionStart: 2, initialSelectionEnd: 2 })
    expect(navio.value).toBe('NAXYVIO')
    expect(new URLSearchParams(screen.getByTestId('search').textContent ?? '').get('navio')).toBe('NAXYVIO')
  })

  it('link de fora com a tela aberta troca Navio e Viagem pelos do endereço', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/portal/operacao?tab=bls&navio=NAVIO+DEVOLVIDO&viagem=003W']}>
        <PortalOperacao />
        <Link to="/portal/operacao?tab=bls">Menu BLs e Containers</Link>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('link', { name: 'Menu BLs e Containers' }))
    expect((screen.getByLabelText('Navio') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Viagem') as HTMLInputElement).value).toBe('')
  })
})
